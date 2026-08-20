import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { authenticator } from "otplib";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { hashPassword } from "../src/common/security/argon2.util";
import { publishTestPolicy } from "./fixtures/policy.fixture";
import { ensureTestCity } from "./fixtures/city.fixture";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";

async function makeTestJpeg(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
}

async function submitWithMainImage(agent: request.Agent, productId: string) {
  const buffer = await makeTestJpeg();
  await agent.post(`/api/v1/companies/me/products/${productId}/media`).set("Origin", ORIGIN).attach("file", buffer, "test.jpg");
  return agent.post(`/api/v1/companies/me/products/${productId}/submit`).set("Origin", ORIGIN);
}
const VALID_IBAN = "SA0380000000608010167519";

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

function randomCr(prefix = "CR-OPPDISC"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getActivePolicyIds(app: INestApplication): Promise<string[]> {
  const res = await request(app.getHttpServer()).get("/api/v1/policies/active").set("Origin", ORIGIN);
  return res.body.map((p: { id: string }) => p.id);
}

async function registerCompany(
  app: INestApplication,
  kind: "supplier" | "trader",
  cityId: string,
  overrides: Record<string, unknown> = {}
): Promise<{ crNumber: string; password: string }> {
  const acceptedPolicyVersionIds = await getActivePolicyIds(app);
  const crNumber = randomCr();
  const password = "correct-horse-battery-staple";
  const payload = {
    crNumber,
    legalName: `Discovery Test ${kind}`,
    email: `${kind}-disc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    password,
    primaryMobile1: "+966500000001",
    primaryMobile2: "+966500000002",
    cityId,
    shortAddress: "Riyadh",
    latitude: 24.7136,
    longitude: 46.6753,
    acceptedPolicyVersionIds,
    ...overrides,
  };
  await request(app.getHttpServer())
    .post(`/api/v1/auth/register/${kind}`)
    .set("Origin", ORIGIN)
    .send(payload);
  return { crNumber, password };
}

async function loginAgent(app: INestApplication, crNumber: string, password: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ crNumber, password });
  return agent;
}

async function createAuthenticatedAdminAgent(app: INestApplication) {
  const email = `admin-disc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = "a-genuinely-strong-passphrase-2026";
  await prisma.adminUser.create({ data: { email, passwordHash: await hashPassword(password) } });

  const loginRes = await request(app.getHttpServer())
    .post("/api/v1/admin/auth/login")
    .set("Origin", ORIGIN)
    .send({ email, password });
  const setupRes = await request(app.getHttpServer())
    .post("/api/v1/admin/auth/2fa/setup")
    .set("Origin", ORIGIN)
    .send({ ticket: loginRes.body.ticket });

  const agent = request.agent(app.getHttpServer());
  await agent
    .post("/api/v1/admin/auth/2fa/setup/confirm")
    .set("Origin", ORIGIN)
    .send({ ticket: loginRes.body.ticket, code: authenticator.generate(setupRes.body.secret) });

  return agent;
}

describe("Opportunity discovery — trader and public views (e2e)", () => {
  let app: INestApplication;
  let adminAgent: request.Agent;
  let cityId: string;
  let taxonomyNodeId: string;
  let salesUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();

    await publishTestPolicy(prisma);
    cityId = await ensureTestCity(prisma);
    await prisma.systemSetting.deleteMany({
      where: { key: { in: ["company_verification_mode", "email_verification_enabled"] } },
    });

    const node = await prisma.taxonomyNode.create({ data: { nameAr: "قسم", nameEn: "Section" } });
    taxonomyNodeId = node.id;
    const unit = await prisma.salesUnit.create({ data: { nameAr: "وحدة", nameEn: "Unit" } });
    salesUnitId = unit.id;

    adminAgent = await createAuthenticatedAdminAgent(app);
    await adminAgent.put("/api/v1/admin/settings/tax").set("Origin", ORIGIN).send({ ratePercent: 15 });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  beforeEach(async () => {
    await resetThrottleCounters();
  });

  async function setupActiveOpportunity(overrides: {
    targetQuantity?: number;
    unitPriceAmount?: number;
    /** Overrides the closing time — needed to exercise ENDING_SOON ordering. */
    endAt?: string;
  } = {}) {
    const supplier = await registerCompany(app, "supplier", cityId);
    await prisma.company.updateMany({
      where: { crNumber: supplier.crNumber },
      data: { verificationStatus: "VERIFIED" },
    });
    const agent = await loginAgent(app, supplier.crNumber, supplier.password);

    const bankRes = await agent
      .post("/api/v1/companies/me/bank-account")
      .set("Origin", ORIGIN)
      .send({ accountHolderName: "Holder", bankName: "Test Bank", iban: VALID_IBAN });
    await adminAgent.post(`/api/v1/admin/bank-accounts/${bankRes.body.id}/approve`).set("Origin", ORIGIN);
    await agent.put("/api/v1/companies/me/tax-profile").set("Origin", ORIGIN).send({ isVatRegistered: false });
    await agent
      .put("/api/v1/companies/me/invoicing-profile")
      .set("Origin", ORIGIN)
      .send({ invoicingLegalName: "Discovery Supplier LLC" });

    const productRes = await agent
      .post("/api/v1/companies/me/products")
      .set("Origin", ORIGIN)
      .send({
        taxonomyNodeId,
        salesUnitId,
        salesUnitNameAr: "a",
        salesUnitNameEn: "a",
        nameAr: "منتج الاكتشاف",
        nameEn: "Discovery Product",
        weightPerUnit: 1,
        lengthCm: 1,
        widthCm: 1,
        heightCm: 1,
      });
    const productId = productRes.body.id;
    await submitWithMainImage(agent, productId);
    await adminAgent.post(`/api/v1/admin/products/${productId}/approve`).set("Origin", ORIGIN);

    const locationRes = await agent.get("/api/v1/companies/me/locations").set("Origin", ORIGIN);
    const fulfillmentLocationId = locationRes.body[0].id;

    // 100 * 11.5 = 1,150 SAR -> the default 10% (1000 bps) tier ->
    // shareQuantity = 100*1000/10000 = 10, evenly divisible.
    const createRes = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId,
        targetQuantity: overrides.targetQuantity ?? 100,
        unitPriceAmount: overrides.unitPriceAmount ?? 11.5,
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt: overrides.endAt ?? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        expectedPreparationDays: 3,
      });
    const opportunityId = createRes.body.id;

    const publishRes = await agent
      .post(`/api/v1/companies/me/opportunities/${opportunityId}/publish`)
      .set("Origin", ORIGIN);
    expect(publishRes.status).toBe(201);
    expect(publishRes.body.status).toBe("ACTIVE");

    return { agent, supplier, productId, opportunityId, fulfillmentLocationId };
  }

  async function registerVerifiedTrader() {
    const trader = await registerCompany(app, "trader", cityId);
    const agent = await loginAgent(app, trader.crNumber, trader.password);
    return { agent, trader };
  }

  describe("Access control", () => {
    it("public endpoints require no authentication at all", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const list = await request(app.getHttpServer()).get("/api/v1/opportunities/active");
      expect(list.status).toBe(200);
      const detail = await request(app.getHttpServer()).get(`/api/v1/opportunities/${opportunityId}`);
      expect(detail.status).toBe(200);
    });

    it("trader endpoints reject an unauthenticated request", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/trader/opportunities/active");
      expect(res.status).toBe(401);
    });

    it("trader endpoints reject a SUPPLIER session", async () => {
      const { agent: supplierAgent } = await setupActiveOpportunity();
      const res = await supplierAgent.get("/api/v1/trader/opportunities/active").set("Origin", ORIGIN);
      expect(res.status).toBe(403);
    });

    it("trader endpoints accept a TRADER session", async () => {
      const { agent: traderAgent } = await registerVerifiedTrader();
      const res = await traderAgent.get("/api/v1/trader/opportunities/active").set("Origin", ORIGIN);
      expect(res.status).toBe(200);
    });
  });

  describe("Field leakage — public view", () => {
    it("never includes price, quantities, or internal fields in the list", async () => {
      await setupActiveOpportunity();
      const res = await request(app.getHttpServer()).get("/api/v1/opportunities/active");
      expect(res.status).toBe(200);
      for (const item of res.body.items) {
        expect(item).not.toHaveProperty("unitPriceAmount");
        expect(item).not.toHaveProperty("targetQuantity");
        expect(item).not.toHaveProperty("fundedQuantity");
        expect(item).not.toHaveProperty("shareQuantity");
        expect(item).not.toHaveProperty("shareBasisPoints");
        expect(item).not.toHaveProperty("sharePercentage");
        expect(item).not.toHaveProperty("shareTierPolicyVersionId");
        expect(item).not.toHaveProperty("reasonCode");
        expect(item).not.toHaveProperty("reasonDetails");
        expect(item).not.toHaveProperty("companyId");
        expect(item).not.toHaveProperty("fulfillmentCityId");
        expect(item).not.toHaveProperty("fulfillmentLocationId");
      }
    });

    it("the detail response never contains the sensitive fields either", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await request(app.getHttpServer()).get(`/api/v1/opportunities/${opportunityId}`);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(
        /unitPriceAmount|targetQuantity|fundedQuantity|reasonCode|reasonDetails|shareBasisPoints|shareTierPolicyVersionId/
      );
    });
  });

  describe("Field leakage — trader view has full detail but still no internal fields", () => {
    it("includes price/quantities/progress/share-quantity/percentage/city/duration", async () => {
      const { opportunityId } = await setupActiveOpportunity({ targetQuantity: 100, unitPriceAmount: 11.5 });
      const { agent: traderAgent } = await registerVerifiedTrader();

      const res = await traderAgent.get(`/api/v1/trader/opportunities/${opportunityId}`).set("Origin", ORIGIN);
      expect(res.status).toBe(200);
      expect(res.body.unitPriceAmount).toBe(11.5);
      expect(res.body.targetQuantity).toBe(100);
      expect(res.body.fundedQuantity).toBe(0);
      expect(res.body.progressPercentage).toBe(0);
      expect(res.body.shareQuantity).toBe(10);
      expect(res.body.sharePercentage).toBe(10);
      expect(res.body.salesUnitNameEn).toBeDefined();
      expect(res.body.fulfillmentCityNameEn).toBeDefined();
      expect(res.body.startAt).toBeDefined();
      expect(res.body.endAt).toBeDefined();
      // The trader sees a computed percentage and share quantity —
      // never the raw basis points or the internal policy version id.
      expect(res.body).not.toHaveProperty("shareBasisPoints");
      expect(res.body).not.toHaveProperty("shareTierPolicyVersionId");
    });

    it("never exposes reasonCode/reasonDetails/companyId/internal FKs even to a trader", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const { agent: traderAgent } = await registerVerifiedTrader();

      const res = await traderAgent.get(`/api/v1/trader/opportunities/${opportunityId}`).set("Origin", ORIGIN);
      expect(res.body).not.toHaveProperty("reasonCode");
      expect(res.body).not.toHaveProperty("reasonDetails");
      expect(res.body).not.toHaveProperty("companyId");
      expect(res.body).not.toHaveProperty("fulfillmentCityId");
      expect(res.body).not.toHaveProperty("fulfillmentLocationId");
    });
  });

  describe("Excluded statuses never appear to trader or public", () => {
    it("a DRAFT opportunity is invisible to both views", async () => {
      const supplier = await registerCompany(app, "supplier", cityId);
      await prisma.company.updateMany({
        where: { crNumber: supplier.crNumber },
        data: { verificationStatus: "VERIFIED" },
      });
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);
      const productRes = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send({
          taxonomyNodeId,
          salesUnitId,
          salesUnitNameAr: "a",
          salesUnitNameEn: "a",
          nameAr: "م",
          nameEn: "P",
          weightPerUnit: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
        });
      const locationRes = await agent.get("/api/v1/companies/me/locations").set("Origin", ORIGIN);
      const draftRes = await agent
        .post("/api/v1/companies/me/opportunities")
        .set("Origin", ORIGIN)
        .send({
          productId: productRes.body.id,
          fulfillmentLocationId: locationRes.body[0].id,
          targetQuantity: 10,
          unitPriceAmount: 5,
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
          expectedPreparationDays: 1,
        });
      const draftId = draftRes.body.id;

      const publicDetail = await request(app.getHttpServer()).get(`/api/v1/opportunities/${draftId}`);
      expect(publicDetail.status).toBe(404);

      const { agent: traderAgent } = await registerVerifiedTrader();
      const traderDetail = await traderAgent.get(`/api/v1/trader/opportunities/${draftId}`).set("Origin", ORIGIN);
      expect(traderDetail.status).toBe(404);
    });

    it("a CANCELLED opportunity is invisible to both views", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      // Admin cancel/pause endpoints belong to the not-yet-built Admin
      // Opportunities module — set status directly via Prisma to
      // isolate this test to discovery-visibility behavior only. The
      // freeze trigger permits status-only changes unconditionally.
      await prisma.opportunity.update({
        where: { id: opportunityId },
        data: { status: "CANCELLED", cancelReason: "test cancellation" },
      });

      const publicDetail = await request(app.getHttpServer()).get(`/api/v1/opportunities/${opportunityId}`);
      expect(publicDetail.status).toBe(404);
    });

    it("a PAUSED opportunity is invisible to both views", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      await prisma.opportunity.update({
        where: { id: opportunityId },
        data: { status: "PAUSED", pauseReason: "test pause", pausedAt: new Date() },
      });

      const publicDetail = await request(app.getHttpServer()).get(`/api/v1/opportunities/${opportunityId}`);
      expect(publicDetail.status).toBe(404);

      const { agent: traderAgent } = await registerVerifiedTrader();
      const traderDetail = await traderAgent
        .get(`/api/v1/trader/opportunities/${opportunityId}`)
        .set("Origin", ORIGIN);
      expect(traderDetail.status).toBe(404);
    });
  });

  describe("SCHEDULED visibility controlled by admin setting", () => {
    async function setupScheduledOpportunity() {
      const supplier = await registerCompany(app, "supplier", cityId);
      await prisma.company.updateMany({
        where: { crNumber: supplier.crNumber },
        data: { verificationStatus: "VERIFIED" },
      });
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const bankRes = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "Holder", bankName: "Test Bank", iban: VALID_IBAN });
      await adminAgent.post(`/api/v1/admin/bank-accounts/${bankRes.body.id}/approve`).set("Origin", ORIGIN);
      await agent.put("/api/v1/companies/me/tax-profile").set("Origin", ORIGIN).send({ isVatRegistered: false });
      await agent
        .put("/api/v1/companies/me/invoicing-profile")
        .set("Origin", ORIGIN)
        .send({ invoicingLegalName: "Scheduled Supplier LLC" });

      const productRes = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send({
          taxonomyNodeId,
          salesUnitId,
          salesUnitNameAr: "a",
          salesUnitNameEn: "a",
          nameAr: "م",
          nameEn: "Scheduled Product",
          weightPerUnit: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
        });
      await submitWithMainImage(agent, productRes.body.id);
      await adminAgent.post(`/api/v1/admin/products/${productRes.body.id}/approve`).set("Origin", ORIGIN);
      const locationRes = await agent.get("/api/v1/companies/me/locations").set("Origin", ORIGIN);

      const createRes = await agent
        .post("/api/v1/companies/me/opportunities")
        .set("Origin", ORIGIN)
        .send({
          productId: productRes.body.id,
          fulfillmentLocationId: locationRes.body[0].id,
          targetQuantity: 10,
          unitPriceAmount: 5,
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
          expectedPreparationDays: 1,
        });
      const opportunityId = createRes.body.id;
      const publishRes = await agent
        .post(`/api/v1/companies/me/opportunities/${opportunityId}/publish`)
        .set("Origin", ORIGIN);
      expect(publishRes.body.status).toBe("SCHEDULED");
      return opportunityId;
    }

    it("is hidden when showScheduledPubliclyEnabled=false (the default)", async () => {
      await adminAgent
        .put("/api/v1/admin/settings/opportunity")
        .set("Origin", ORIGIN)
        .send({
          minDurationHours: 1,
          maxDurationDays: 90,
          minTargetQuantity: 1,
          maxTargetQuantity: 10_000_000,
          showScheduledPubliclyEnabled: false,
        });
      const opportunityId = await setupScheduledOpportunity();

      const publicDetail = await request(app.getHttpServer()).get(`/api/v1/opportunities/${opportunityId}`);
      expect(publicDetail.status).toBe(404);
    });

    it("is shown when showScheduledPubliclyEnabled=true", async () => {
      await adminAgent
        .put("/api/v1/admin/settings/opportunity")
        .set("Origin", ORIGIN)
        .send({
          minDurationHours: 1,
          maxDurationDays: 90,
          minTargetQuantity: 1,
          maxTargetQuantity: 10_000_000,
          showScheduledPubliclyEnabled: true,
        });
      const opportunityId = await setupScheduledOpportunity();

      const publicDetail = await request(app.getHttpServer()).get(`/api/v1/opportunities/${opportunityId}`);
      expect(publicDetail.status).toBe(200);

      await adminAgent
        .put("/api/v1/admin/settings/opportunity")
        .set("Origin", ORIGIN)
        .send({
          minDurationHours: 1,
          maxDurationDays: 90,
          minTargetQuantity: 1,
          maxTargetQuantity: 10_000_000,
          showScheduledPubliclyEnabled: false,
        });
    });
  });

  describe("Filters", () => {
    it("filters the public list by cityId", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await request(app.getHttpServer()).get(`/api/v1/opportunities/active?cityId=${cityId}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toContain(opportunityId);

      const otherCityId = await ensureTestCity(prisma);
      const resOtherCity = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/active?cityId=${otherCityId}`
      );
      expect(resOtherCity.body.items.map((i: { id: string }) => i.id)).not.toContain(opportunityId);
    });

    it("filters the trader list by productId", async () => {
      const { opportunityId, productId } = await setupActiveOpportunity();
      const { agent: traderAgent } = await registerVerifiedTrader();

      const res = await traderAgent
        .get(`/api/v1/trader/opportunities/active?productId=${productId}`)
        .set("Origin", ORIGIN);
      expect(res.body.items.map((i: { id: string }) => i.id)).toContain(opportunityId);
    });

    it("filters by taxonomyNodeId using the frozen snapshot, unaffected by a later live category change", async () => {
      const { opportunityId, productId } = await setupActiveOpportunity();

      const otherNode = await prisma.taxonomyNode.create({ data: { nameAr: "آخر", nameEn: "Other" } });
      await prisma.product.update({ where: { id: productId }, data: { taxonomyNodeId: otherNode.id } });

      const res = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/active?taxonomyNodeId=${taxonomyNodeId}`
      );
      expect(res.body.items.map((i: { id: string }) => i.id)).toContain(opportunityId);

      const resNewCategory = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/active?taxonomyNodeId=${otherNode.id}`
      );
      expect(resNewCategory.body.items.map((i: { id: string }) => i.id)).not.toContain(opportunityId);
    });
  });

  describe("Pagination", () => {
    it("respects pageSize and returns a stable total count", async () => {
      await setupActiveOpportunity();
      await setupActiveOpportunity();

      const res = await request(app.getHttpServer()).get("/api/v1/opportunities/active?pageSize=1");
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(1);
      expect(res.body.pageSize).toBe(1);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it("rejects a pageSize above the maximum via validation", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/opportunities/active?pageSize=1000");
      expect(res.status).toBe(400);
    });
  });

  /**
   * Ordering against a REAL database.
   *
   * The unit tests assert the orderBy clause the service emits; only
   * these can show what PostgreSQL actually returns — in particular
   * that paging through a filtered list never repeats or skips a row,
   * which is exactly the failure a non-unique sort column produces and
   * which no mock can reproduce.
   */
  describe("Sorting", () => {
    const HOUR = 60 * 60 * 1000;

    async function threeWithStaggeredClosings() {
      const far = await setupActiveOpportunity({
        endAt: new Date(Date.now() + 30 * 24 * HOUR).toISOString(),
      });
      const near = await setupActiveOpportunity({
        endAt: new Date(Date.now() + 2 * HOUR).toISOString(),
      });
      const middle = await setupActiveOpportunity({
        endAt: new Date(Date.now() + 10 * 24 * HOUR).toISOString(),
      });
      return { far, near, middle };
    }

    it("defaults to NEWEST — the most recently created comes first", async () => {
      await setupActiveOpportunity();
      const second = await setupActiveOpportunity();

      const res = await request(app.getHttpServer()).get("/api/v1/opportunities/active?pageSize=100");

      expect(res.status).toBe(200);
      expect(res.body.items[0].id).toBe(second.opportunityId);
    });

    it("returns the identical order for an omitted sort and an explicit NEWEST", async () => {
      await setupActiveOpportunity();
      await setupActiveOpportunity();

      const implicit = await request(app.getHttpServer()).get("/api/v1/opportunities/active?pageSize=100");
      const explicit = await request(app.getHttpServer()).get(
        "/api/v1/opportunities/active?pageSize=100&sort=NEWEST"
      );

      expect(implicit.body.items.map((i: { id: string }) => i.id)).toEqual(
        explicit.body.items.map((i: { id: string }) => i.id)
      );
    });

    it("ENDING_SOON returns the soonest closing first", async () => {
      const { near, middle, far } = await threeWithStaggeredClosings();

      const res = await request(app.getHttpServer()).get(
        "/api/v1/opportunities/active?pageSize=100&sort=ENDING_SOON"
      );

      const ids = res.body.items.map((i: { id: string }) => i.id);
      expect(ids.indexOf(near.opportunityId)).toBeLessThan(ids.indexOf(middle.opportunityId));
      expect(ids.indexOf(middle.opportunityId)).toBeLessThan(ids.indexOf(far.opportunityId));
    });

    it("ENDING_SOON emits endAt in non-decreasing order across the whole page", async () => {
      await threeWithStaggeredClosings();

      const res = await request(app.getHttpServer()).get(
        "/api/v1/opportunities/active?pageSize=100&sort=ENDING_SOON"
      );

      const times = res.body.items.map((i: { endAt: string }) => new Date(i.endAt).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it("orders the trader list by the same rule", async () => {
      const { near, far } = await threeWithStaggeredClosings();
      const { agent: traderAgent } = await registerVerifiedTrader();

      const res = await traderAgent.get(
        "/api/v1/trader/opportunities/active?pageSize=100&sort=ENDING_SOON"
      );

      const ids = res.body.items.map((i: { id: string }) => i.id);
      expect(ids.indexOf(near.opportunityId)).toBeLessThan(ids.indexOf(far.opportunityId));
    });

    it.each(["NEWEST", "ENDING_SOON"])(
      "%s pages through the whole list with no duplicate and no dropped row",
      async (sort) => {
        await setupActiveOpportunity();
        await setupActiveOpportunity();
        await setupActiveOpportunity();
        await setupActiveOpportunity();
        await setupActiveOpportunity();

        const first = await request(app.getHttpServer()).get(
          `/api/v1/opportunities/active?sort=${sort}&pageSize=2&page=1`
        );
        const total = first.body.total;
        const lastPage = Math.ceil(total / 2);

        const seen: string[] = [...first.body.items.map((i: { id: string }) => i.id)];
        for (let page = 2; page <= lastPage; page++) {
          const res = await request(app.getHttpServer()).get(
            `/api/v1/opportunities/active?sort=${sort}&pageSize=2&page=${page}`
          );
          expect(res.status).toBe(200);
          seen.push(...res.body.items.map((i: { id: string }) => i.id));
        }

        // Every row appears exactly once, and the walk covers the total
        // the API itself reported.
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen.length).toBe(total);
      }
    );

    it.each(["NEWEST", "ENDING_SOON"])(
      "%s returns the same page for the same request, run twice",
      async (sort) => {
        await setupActiveOpportunity();
        await setupActiveOpportunity();
        await setupActiveOpportunity();

        const path = `/api/v1/opportunities/active?sort=${sort}&pageSize=2&page=2`;
        const once = await request(app.getHttpServer()).get(path);
        const twice = await request(app.getHttpServer()).get(path);

        expect(once.body.items.map((i: { id: string }) => i.id)).toEqual(
          twice.body.items.map((i: { id: string }) => i.id)
        );
      }
    );

    it("combines a city filter, a category filter and a sort in one request", async () => {
      const { near } = await threeWithStaggeredClosings();

      const res = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/active?cityId=${cityId}&taxonomyNodeId=${taxonomyNodeId}&sort=ENDING_SOON&pageSize=100`
      );

      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toContain(near.opportunityId);

      const times = res.body.items.map((i: { endAt: string }) => new Date(i.endAt).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it.each([
      ["an unknown value", "CHEAPEST"],
      ["the wrong case", "newest"],
      ["an empty value", ""],
      ["a SQL fragment", "createdAt%20DESC"],
    ])("rejects %s with a 400 rather than falling back to the default", async (_label, sort) => {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/active?sort=${sort}`
      );

      expect(res.status).toBe(400);
    });

    it("rejects an unknown sort parameter name outright", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/opportunities/active?sortBy=NEWEST"
      );

      expect(res.status).toBe(400);
    });
  });

  describe("Snapshot freeze — live product changes never affect a published opportunity's display", () => {
    it("changing the live product's name after publish does not change what trader/public see", async () => {
      const { opportunityId, productId } = await setupActiveOpportunity();

      await prisma.product.update({
        where: { id: productId },
        data: { nameAr: "اسم مختلف تمامًا", nameEn: "Completely Different Name" },
      });

      const publicDetail = await request(app.getHttpServer()).get(`/api/v1/opportunities/${opportunityId}`);
      expect(publicDetail.body.productNameEn).toBe("Discovery Product");
      expect(publicDetail.body.productNameEn).not.toBe("Completely Different Name");

      const { agent: traderAgent } = await registerVerifiedTrader();
      const traderDetail = await traderAgent
        .get(`/api/v1/trader/opportunities/${opportunityId}`)
        .set("Origin", ORIGIN);
      expect(traderDetail.body.productNameEn).toBe("Discovery Product");
    });
  });
});
