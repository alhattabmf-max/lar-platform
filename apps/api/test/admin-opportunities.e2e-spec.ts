import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaClient, type OpportunityStatus } from "@prisma/client";
import Redis from "ioredis";
import { authenticator } from "otplib";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { hashPassword } from "../src/common/security/argon2.util";
import { publishTestPolicy } from "./fixtures/policy.fixture";
import { ensureTestPlace, type TestPlace } from "./fixtures/city.fixture";
import { createBranch, verifySupplierThroughReview } from "./fixtures/branch.fixture";
import { uniqueMobile } from "./fixtures/unique";

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

function randomCr(): string {
  return `CR-ADMINOPP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getActivePolicyIds(app: INestApplication): Promise<string[]> {
  const res = await request(app.getHttpServer()).get("/api/v1/policies/active").set("Origin", ORIGIN);
  return res.body.map((p: { id: string }) => p.id);
}

async function loginAgent(app: INestApplication, crNumber: string, password: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ crNumber, password });
  return agent;
}

async function createAuthenticatedAdminAgent(app: INestApplication) {
  const email = `admin-adminopp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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

describe("Admin Opportunities (e2e)", () => {
  let app: INestApplication;
  let place: TestPlace;
  let adminAgent: request.Agent;
  let taxonomyNodeId: string;
  let salesUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();

    await publishTestPolicy(prisma);
    // Registration no longer creates a branch; each company makes its
    // own through the branches endpoint, which needs a real region.
    place = await ensureTestPlace(prisma);
    await prisma.systemSetting.deleteMany({
      where: { key: { in: ["company_verification_mode", "email_verification_enabled"] } },
    });

    const node = await prisma.taxonomyNode.create({ data: { nameAr: "قسم", nameEn: "Section" } });
    taxonomyNodeId = node.id;
    const unit = await prisma.salesUnit.create({ data: { nameAr: "كرتون", nameEn: "Carton" } });
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

  async function setupActiveOpportunity() {
    const crNumber = randomCr();
    const password = "correct-horse-battery-staple";
    const acceptedPolicyVersionIds = await getActivePolicyIds(app);
    await request(app.getHttpServer())
      .post("/api/v1/auth/register/supplier")
      .set("Origin", ORIGIN)
      .send({
        crNumber,
        legalName: "Admin Opp Supplier",
        email: `adminopp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
        password,
        primaryMobile1: uniqueMobile(),
        acceptedPolicyVersionIds,
      });
    const agent = await loginAgent(app, crNumber, password);

    // THE RECORD IS COMPLETED FIRST, THEN REVIEWED — a supplier becomes
    // VERIFIED only by an approved review, and that same approval is
    // what activates the bank account, which is why
    // `POST /admin/bank-accounts/:id/approve` no longer exists.
    await agent
      .post("/api/v1/companies/me/bank-account")
      .set("Origin", ORIGIN)
      .send({ accountHolderName: "Holder", iban: VALID_IBAN });
    await agent.put("/api/v1/companies/me/tax-profile").set("Origin", ORIGIN).send({ isVatRegistered: false });
    await agent
      .put("/api/v1/companies/me/invoicing-profile")
      .set("Origin", ORIGIN)
      .send({ invoicingLegalName: "Admin Opp Supplier LLC" });
    const branch = await createBranch(agent, ORIGIN, place);
    const fulfillmentLocationId = branch.id;
    await verifySupplierThroughReview(agent, adminAgent, ORIGIN, branch.companyId as string);

    const productRes = await agent
      .post("/api/v1/companies/me/products")
      .set("Origin", ORIGIN)
      .send({
        taxonomyNodeId,
        salesUnitId,
        salesUnitNameAr: "a",
        salesUnitNameEn: "a",
        nameAr: "منتج",
        nameEn: "Admin Opp Product",
        weightPerUnit: 1,
        lengthCm: 1,
        widthCm: 1,
        heightCm: 1,
      });
    const productId = productRes.body.id;
    await submitWithMainImage(agent, productId);
    await adminAgent.post(`/api/v1/admin/products/${productId}/approve`).set("Origin", ORIGIN);


    const createRes = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId,
        targetQuantity: 100,
        unitPriceAmount: 11.5,
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt: new Date(Date.now() + 5 * 24 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    const opportunityId = createRes.body.id;

    const publishRes = await agent
      .post(`/api/v1/companies/me/opportunities/${opportunityId}/publish`)
      .set("Origin", ORIGIN);
    expect(publishRes.body.status).toBe("ACTIVE");

    return { agent, opportunityId };
  }

  describe("Access control", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/admin/opportunities");
      expect(res.status).toBe(401);
    });

    it("rejects a supplier session (not an admin session)", async () => {
      const { agent: supplierAgent } = await setupActiveOpportunity();
      const res = await supplierAgent.get("/api/v1/admin/opportunities").set("Origin", ORIGIN);
      expect(res.status).toBe(401);
    });

    it("accepts an authenticated admin session", async () => {
      const res = await adminAgent.get("/api/v1/admin/opportunities").set("Origin", ORIGIN);
      expect(res.status).toBe(200);
    });
  });

  describe("List, filters, pagination", () => {
    it("lists opportunities across ALL statuses and companies, unlike trader/public", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await adminAgent.get("/api/v1/admin/opportunities").set("Origin", ORIGIN);
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toContain(opportunityId);
    });

    it("filters by status", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await adminAgent.get("/api/v1/admin/opportunities?status=ACTIVE").set("Origin", ORIGIN);
      expect(res.body.items.map((i: { id: string }) => i.id)).toContain(opportunityId);

      const resOther = await adminAgent.get("/api/v1/admin/opportunities?status=DRAFT").set("Origin", ORIGIN);
      expect(resOther.body.items.map((i: { id: string }) => i.id)).not.toContain(opportunityId);
    });

    it("filters by companyId", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
      const res = await adminAgent
        .get(`/api/v1/admin/opportunities?companyId=${row.companyId}`)
        .set("Origin", ORIGIN);
      expect(res.body.items.map((i: { id: string }) => i.id)).toContain(opportunityId);
    });

    it("rejects a pageSize above the maximum", async () => {
      const res = await adminAgent.get("/api/v1/admin/opportunities?pageSize=1000").set("Origin", ORIGIN);
      expect(res.status).toBe(400);
    });
  });

  describe("Detail — field leakage", () => {
    it("admin sees sharePercentage/shareQuantity/reasonCode/companyId, never raw shareBasisPoints or shareTierPolicyVersionId", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await adminAgent.get(`/api/v1/admin/opportunities/${opportunityId}`).set("Origin", ORIGIN);
      expect(res.status).toBe(200);
      expect(res.body.sharePercentage).toBe(10);
      expect(res.body.shareQuantity).toBe(10);
      expect(res.body.companyId).toBeDefined();
      expect(res.body.reasonCode).toBeNull();
      expect(res.body).not.toHaveProperty("shareBasisPoints");
      expect(res.body).not.toHaveProperty("shareTierPolicyVersionId");
      expect(res.body).not.toHaveProperty("productApprovalSnapshotId");
      expect(res.body).not.toHaveProperty("fulfillmentCityId");
    });

    it("returns 404 for a missing opportunity", async () => {
      const res = await adminAgent
        .get("/api/v1/admin/opportunities/00000000-0000-0000-0000-000000000000")
        .set("Origin", ORIGIN);
      expect(res.status).toBe(404);
    });
  });

  describe("Pause", () => {
    it("requires a reason", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await adminAgent
        .post(`/api/v1/admin/opportunities/${opportunityId}/pause`)
        .set("Origin", ORIGIN)
        .send({});
      expect(res.status).toBe(400);
    });

    it("pauses an ACTIVE opportunity and records the reason, with an atomic audit entry", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await adminAgent
        .post(`/api/v1/admin/opportunities/${opportunityId}/pause`)
        .set("Origin", ORIGIN)
        .send({ reason: "policy violation under review" });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("PAUSED");
      expect(res.body.pauseReason).toBe("policy violation under review");

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: opportunityId, action: "OPPORTUNITY_PAUSED" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.reason).toBe("policy violation under review");
    });

    it("rejects pausing a non-ACTIVE opportunity", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      await adminAgent
        .post(`/api/v1/admin/opportunities/${opportunityId}/pause`)
        .set("Origin", ORIGIN)
        .send({ reason: "first pause" });

      const secondAttempt = await adminAgent
        .post(`/api/v1/admin/opportunities/${opportunityId}/pause`)
        .set("Origin", ORIGIN)
        .send({ reason: "second pause attempt" });
      expect(secondAttempt.status).toBe(409);
    });
  });

  describe("Resume", () => {
    it("resumes a PAUSED opportunity back to ACTIVE", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      await adminAgent
        .post(`/api/v1/admin/opportunities/${opportunityId}/pause`)
        .set("Origin", ORIGIN)
        .send({ reason: "temporary hold" });

      const res = await adminAgent.post(`/api/v1/admin/opportunities/${opportunityId}/resume`).set("Origin", ORIGIN);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("ACTIVE");
      expect(res.body.pauseReason).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: opportunityId, action: "OPPORTUNITY_RESUMED" },
      });
      expect(audit).not.toBeNull();
    });

    it("self-corrects to EXPIRED instead of resuming when end_at has already passed", async () => {
      const { opportunityId: activeId } = await setupActiveOpportunity();
      // Read the fully-published row to reuse its real snapshot data,
      // then seed a SEPARATE opportunity directly via INSERT (which
      // bypasses the freeze trigger — it only guards UPDATE) already
      // PAUSED with end_at in the past, since directly UPDATing
      // end_at on an already-first_activated_at row is correctly
      // rejected by the trigger (proving that protection works).
      const template = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeId } });
      const seeded = await prisma.opportunity.create({
        data: {
          companyId: template.companyId,
          productId: template.productId,
          fulfillmentLocationId: template.fulfillmentLocationId,
          fulfillmentCityId: template.fulfillmentCityId,
          fulfillmentCityNameAr: template.fulfillmentCityNameAr,
          fulfillmentCityNameEn: template.fulfillmentCityNameEn,
          fulfillmentRegionId: template.fulfillmentRegionId,
          fulfillmentRegionNameAr: template.fulfillmentRegionNameAr,
          fulfillmentRegionNameEn: template.fulfillmentRegionNameEn,
          productApprovalSnapshotId: template.productApprovalSnapshotId,
          targetQuantity: template.targetQuantity,
          unitPriceAmount: template.unitPriceAmount,
          startAt: new Date(Date.now() - 2 * 3600_000),
          endAt: new Date(Date.now() - 1000), // already ended
          expectedPreparationDays: template.expectedPreparationDays,
          status: "PAUSED",
          firstActivatedAt: new Date(Date.now() - 2 * 3600_000),
          pausedAt: new Date(Date.now() - 1800_000),
          pauseReason: "hold",
          taxRatePercent: template.taxRatePercent,
          unitPriceExclTaxAmount: template.unitPriceExclTaxAmount,
          unitTaxAmount: template.unitTaxAmount,
          taxCalculationRuleCode: template.taxCalculationRuleCode,
          taxCalculationRuleVersion: template.taxCalculationRuleVersion,
          totalValueInclTaxAmount: template.totalValueInclTaxAmount,
          shareTierPolicyVersionId: template.shareTierPolicyVersionId,
          shareTierIndex: template.shareTierIndex,
          shareBasisPoints: template.shareBasisPoints,
          shareQuantity: template.shareQuantity,
          salesUnitNameAr: template.salesUnitNameAr,
          salesUnitNameEn: template.salesUnitNameEn,
          commissionPolicyVersionId: template.commissionPolicyVersionId,
          commissionRateBasisPoints: template.commissionRateBasisPoints,
        },
      });

      const res = await adminAgent.post(`/api/v1/admin/opportunities/${seeded.id}/resume`).set("Origin", ORIGIN);
      expect(res.status).toBe(409);

      const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: seeded.id } });
      expect(row.status).toBe("EXPIRED");

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: seeded.id, action: "OPPORTUNITY_EXPIRED" },
      });
      expect(audit?.actorType).toBe("SYSTEM");
    });

    it("rejects resuming a non-PAUSED opportunity", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await adminAgent.post(`/api/v1/admin/opportunities/${opportunityId}/resume`).set("Origin", ORIGIN);
      expect(res.status).toBe(400);
    });
  });

  describe("Cancel", () => {
    it("requires a reason", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await adminAgent
        .post(`/api/v1/admin/opportunities/${opportunityId}/cancel`)
        .set("Origin", ORIGIN)
        .send({});
      expect(res.status).toBe(400);
    });

    it("cancels an ACTIVE opportunity with a mandatory reason, audit recorded", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      const res = await adminAgent
        .post(`/api/v1/admin/opportunities/${opportunityId}/cancel`)
        .set("Origin", ORIGIN)
        .send({ reason: "regulatory violation confirmed" });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("CANCELLED");
      expect(res.body.cancelReason).toBe("regulatory violation confirmed");

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: opportunityId, action: "OPPORTUNITY_CANCELLED" },
      });
      expect(audit?.reason).toBe("regulatory violation confirmed");
    });

    it("REJECTS cancelling an ACTION_REQUIRED opportunity — admin cannot substitute for the supplier fixing it", async () => {
      const { opportunityId } = await setupActiveOpportunity();
      await prisma.opportunity.update({
        where: { id: opportunityId },
        data: {
          status: "ACTION_REQUIRED",
          reasonCode: "SUPPLIER_NOT_FINANCIALLY_READY",
          reasonDetails: "seed",
          blockedAt: new Date(),
        },
      });

      const res = await adminAgent
        .post(`/api/v1/admin/opportunities/${opportunityId}/cancel`)
        .set("Origin", ORIGIN)
        .send({ reason: "attempted admin cancel" });
      expect(res.status).toBe(400);

      const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
      expect(row.status).toBe("ACTION_REQUIRED");
    });

    it.each(["FUNDED", "EXPIRED", "CANCELLED"])("rejects cancelling a terminal %s opportunity", async (status) => {
      const { opportunityId } = await setupActiveOpportunity();
      await prisma.opportunity.update({
        where: { id: opportunityId },
        data: { status: status as OpportunityStatus },
      });

      const res = await adminAgent
        .post(`/api/v1/admin/opportunities/${opportunityId}/cancel`)
        .set("Origin", ORIGIN)
        .send({ reason: "reason" });
      expect(res.status).toBe(400);
    });
  });
});
