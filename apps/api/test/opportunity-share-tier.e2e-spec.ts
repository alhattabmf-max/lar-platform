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

function randomCr(): string {
  return `CR-SHARETIER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const email = `admin-sharetier-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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

describe("Opportunity share-tier policy (e2e)", () => {
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

  async function readySupplier() {
    const crNumber = randomCr();
    const password = "correct-horse-battery-staple";
    const acceptedPolicyVersionIds = await getActivePolicyIds(app);
    await request(app.getHttpServer())
      .post("/api/v1/auth/register/supplier")
      .set("Origin", ORIGIN)
      .send({
        crNumber,
        legalName: "ShareTier Supplier",
        email: `sharetier-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
        password,
        primaryMobile1: "+966500000001",
        primaryMobile2: "+966500000002",
        cityId,
        shortAddress: "Riyadh",
        latitude: 24.7136,
        longitude: 46.6753,
        acceptedPolicyVersionIds,
      });
    await prisma.company.updateMany({ where: { crNumber }, data: { verificationStatus: "VERIFIED" } });
    const agent = await loginAgent(app, crNumber, password);

    const bankRes = await agent
      .post("/api/v1/companies/me/bank-account")
      .set("Origin", ORIGIN)
      .send({ accountHolderName: "Holder", bankName: "Test Bank", iban: VALID_IBAN });
    await adminAgent.post(`/api/v1/admin/bank-accounts/${bankRes.body.id}/approve`).set("Origin", ORIGIN);
    await agent.put("/api/v1/companies/me/tax-profile").set("Origin", ORIGIN).send({ isVatRegistered: false });
    await agent
      .put("/api/v1/companies/me/invoicing-profile")
      .set("Origin", ORIGIN)
      .send({ invoicingLegalName: "ShareTier Supplier LLC" });

    const productRes = await agent
      .post("/api/v1/companies/me/products")
      .set("Origin", ORIGIN)
      .send({
        taxonomyNodeId,
        salesUnitId,
        salesUnitNameAr: "a",
        salesUnitNameEn: "a",
        nameAr: "منتج",
        nameEn: "Share Product",
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

    return { agent, productId, fulfillmentLocationId };
  }

  it("a DRAFT opportunity has no share-tier snapshot at all", async () => {
    const { agent, productId, fulfillmentLocationId } = await readySupplier();

    const createRes = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId,
        targetQuantity: 100,
        unitPriceAmount: 11.5,
        startAt: new Date(Date.now() + 3600_000).toISOString(),
        endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("DRAFT");
    expect(createRes.body.sharePercentage).toBeNull();
    expect(createRes.body.shareQuantity).toBeNull();
    expect(createRes.body.totalValueInclTaxAmount).toBeNull();

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: createRes.body.id } });
    expect(row.shareTierPolicyVersionId).toBeNull();
    expect(row.shareBasisPoints).toBeNull();
    expect(row.salesUnitNameAr).toBeNull();
    expect(row.commissionPolicyVersionId).toBeNull();
  });

  it("ACTION_REQUIRED: a plain PATCH leaves the share-tier snapshot completely untouched", async () => {
    const { agent, productId, fulfillmentLocationId } = await readySupplier();

    const policyV1 = await prisma.shareTierPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });
    const commissionV1 = await prisma.commissionPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });
    const city = await prisma.city.findUniqueOrThrow({ where: { id: cityId } });
    const snapshot = await prisma.productApprovalSnapshot.findFirstOrThrow({
      where: { productId },
      orderBy: { approvedAt: "desc" },
    });
    const companyId = (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).companyId;

    const seeded = await prisma.opportunity.create({
      data: {
        companyId,
        productId,
        fulfillmentLocationId,
        targetQuantity: 100,
        unitPriceAmount: 11.5,
        startAt: new Date(Date.now() + 3600_000),
        endAt: new Date(Date.now() + 30 * 3600_000),
        expectedPreparationDays: 3,
        status: "ACTION_REQUIRED",
        reasonCode: "SUPPLIER_NOT_FINANCIALLY_READY",
        reasonDetails: "seed",
        blockedAt: new Date(),
        fulfillmentCityId: cityId,
        fulfillmentCityNameAr: "a",
        fulfillmentCityNameEn: "a",
        fulfillmentRegionId: city.regionId,
        fulfillmentRegionNameAr: "a",
        fulfillmentRegionNameEn: "a",
        productApprovalSnapshotId: snapshot.id,
        taxRatePercent: 15,
        unitPriceExclTaxAmount: 10,
        unitTaxAmount: 1.5,
        taxCalculationRuleCode: "DEFAULT",
        taxCalculationRuleVersion: "v1",
        totalValueInclTaxAmount: 1150,
        shareTierPolicyVersionId: policyV1.id,
        shareTierIndex: 0,
        shareBasisPoints: 1000,
        shareQuantity: 10,
        salesUnitNameAr: "كرتون",
        salesUnitNameEn: "Carton",
        commissionPolicyVersionId: commissionV1.id,
        commissionRateBasisPoints: commissionV1.rateBasisPoints,
      },
    });

    const patchRes = await agent
      .patch(`/api/v1/companies/me/opportunities/${seeded.id}`)
      .set("Origin", ORIGIN)
      .send({ descriptionEn: "just a description edit" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("ACTION_REQUIRED");
    expect(patchRes.body.sharePercentage).toBe(10);
    expect(patchRes.body.shareQuantity).toBe(10);
    expect(patchRes.body.reasonCode).toBe("SUPPLIER_NOT_FINANCIALLY_READY");

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(row.shareTierPolicyVersionId).toBe(policyV1.id);
    expect(row.shareBasisPoints).toBe(1000);
    expect(row.shareQuantity).toBe(10);
  });

  it("SCHEDULED: editing the price keeps the same policy version but can move the tier (10% -> 5% -> 2.5%)", async () => {
    const { agent, productId, fulfillmentLocationId } = await readySupplier();

    // targetQuantity=40 is a multiple of every tier's step (10, 20, 40)
    // so it stays compatible across all three tiers as the price moves.
    const createRes = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId,
        targetQuantity: 40,
        unitPriceAmount: 11.5, // total 460 -> tier 0 (10%)
        startAt: new Date(Date.now() + 3600_000).toISOString(),
        endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    const id = createRes.body.id;

    const publishRes = await agent.post(`/api/v1/companies/me/opportunities/${id}/publish`).set("Origin", ORIGIN);
    expect(publishRes.status).toBe(201);
    expect(publishRes.body.status).toBe("SCHEDULED");
    expect(publishRes.body.sharePercentage).toBe(10);
    expect(publishRes.body.shareQuantity).toBe(4);
    const originalPolicyVersionId = (await prisma.opportunity.findUniqueOrThrow({ where: { id } }))
      .shareTierPolicyVersionId;
    expect(originalPolicyVersionId).not.toBeNull();

    // 40 * 1300 = 52,000 -> tier 1 (5%). 40*500%10000=0 -> shareQuantity=2.
    const patch1 = await agent
      .patch(`/api/v1/companies/me/opportunities/${id}`)
      .set("Origin", ORIGIN)
      .send({ unitPriceAmount: 1300 });
    expect(patch1.status).toBe(200);
    expect(patch1.body.sharePercentage).toBe(5);
    expect(patch1.body.shareQuantity).toBe(2);

    // 40 * 5100 = 204,000 -> tier 2 (2.5%, open-ended). 40*250%10000=0 -> shareQuantity=1.
    const patch2 = await agent
      .patch(`/api/v1/companies/me/opportunities/${id}`)
      .set("Origin", ORIGIN)
      .send({ unitPriceAmount: 5100 });
    expect(patch2.status).toBe(200);
    expect(patch2.body.sharePercentage).toBe(2.5);
    expect(patch2.body.shareQuantity).toBe(1);

    const finalRow = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(finalRow.shareTierPolicyVersionId).toBe(originalPolicyVersionId);
    expect(finalRow.shareBasisPoints).toBe(250);
  });

  it("SCHEDULED: an incompatible targetQuantity edit is rejected, and the row is unchanged", async () => {
    const { agent, productId, fulfillmentLocationId } = await readySupplier();

    const createRes = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId,
        targetQuantity: 100,
        unitPriceAmount: 11.5,
        startAt: new Date(Date.now() + 3600_000).toISOString(),
        endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    const id = createRes.body.id;
    await agent.post(`/api/v1/companies/me/opportunities/${id}/publish`).set("Origin", ORIGIN);

    const before = await prisma.opportunity.findUniqueOrThrow({ where: { id } });

    const patchRes = await agent
      .patch(`/api/v1/companies/me/opportunities/${id}`)
      .set("Origin", ORIGIN)
      .send({ targetQuantity: 7 });
    expect(patchRes.status).toBe(400);

    const after = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(after.targetQuantity).toBe(before.targetQuantity);
    expect(after.shareBasisPoints).toBe(before.shareBasisPoints);
    expect(after.shareQuantity).toBe(before.shareQuantity);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("republish from ACTION_REQUIRED with an incompatible quantity sets the closed reason code, stays ACTION_REQUIRED", async () => {
    const { agent, productId, fulfillmentLocationId } = await readySupplier();
    const companyId = (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).companyId;
    const policyV1 = await prisma.shareTierPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });
    const commissionV1 = await prisma.commissionPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });
    const city = await prisma.city.findUniqueOrThrow({ where: { id: cityId } });
    const snapshot = await prisma.productApprovalSnapshot.findFirstOrThrow({
      where: { productId },
      orderBy: { approvedAt: "desc" },
    });

    const seeded = await prisma.opportunity.create({
      data: {
        companyId,
        productId,
        fulfillmentLocationId,
        targetQuantity: 100,
        unitPriceAmount: 11.5,
        startAt: new Date(Date.now() + 3600_000),
        endAt: new Date(Date.now() + 30 * 3600_000),
        expectedPreparationDays: 3,
        status: "ACTION_REQUIRED",
        reasonCode: "SUPPLIER_NOT_FINANCIALLY_READY",
        reasonDetails: "seed",
        blockedAt: new Date(),
        fulfillmentCityId: cityId,
        fulfillmentCityNameAr: "a",
        fulfillmentCityNameEn: "a",
        fulfillmentRegionId: city.regionId,
        fulfillmentRegionNameAr: "a",
        fulfillmentRegionNameEn: "a",
        productApprovalSnapshotId: snapshot.id,
        taxRatePercent: 15,
        unitPriceExclTaxAmount: 10,
        unitTaxAmount: 1.5,
        taxCalculationRuleCode: "DEFAULT",
        taxCalculationRuleVersion: "v1",
        totalValueInclTaxAmount: 1150,
        shareTierPolicyVersionId: policyV1.id,
        shareTierIndex: 0,
        shareBasisPoints: 1000,
        shareQuantity: 10,
        salesUnitNameAr: "كرتون",
        salesUnitNameEn: "Carton",
        commissionPolicyVersionId: commissionV1.id,
        commissionRateBasisPoints: commissionV1.rateBasisPoints,
      },
    });

    const patchRes = await agent
      .patch(`/api/v1/companies/me/opportunities/${seeded.id}`)
      .set("Origin", ORIGIN)
      .send({ targetQuantity: 7 });
    expect(patchRes.status).toBe(200);

    const publishRes = await agent
      .post(`/api/v1/companies/me/opportunities/${seeded.id}/publish`)
      .set("Origin", ORIGIN);
    expect(publishRes.status).toBe(400);
    expect(publishRes.body.error.code).toBe("VALIDATION_FAILED");

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(row.status).toBe("ACTION_REQUIRED");
    expect(row.reasonCode).toBe("PURCHASE_QUANTITY_NOT_COMPATIBLE");
    expect(row.reasonDetails).toBeTruthy();

    const auditRow = await prisma.auditLog.findFirst({
      where: { entityId: seeded.id, action: "OPPORTUNITY_REPUBLISH_BLOCKED" },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.reason).toContain("evenly split");
  });

  it("tier selection uses the tax-inclusive unit price, not the tax-exclusive base", async () => {
    const { agent, productId, fulfillmentLocationId } = await readySupplier();

    const createRes = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId,
        targetQuantity: 100,
        unitPriceAmount: 520,
        startAt: new Date(Date.now() + 3600_000).toISOString(),
        endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    const id = createRes.body.id;

    const publishRes = await agent.post(`/api/v1/companies/me/opportunities/${id}/publish`).set("Origin", ORIGIN);
    expect(publishRes.status).toBe(201);
    expect(publishRes.body.sharePercentage).toBe(5);
    expect(publishRes.body.totalValueInclTaxAmount).toBe(52_000);

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(row.shareBasisPoints).toBe(500);
    expect(Number(row.totalValueInclTaxAmount)).toBe(52_000);
  });

  it("rejects minPurchaseQuantity/maxPurchaseQuantity/sharePercentage with 400 — the ValidationPipe's forbidNonWhitelisted truly rejects them, not silently ignores them", async () => {
    const { agent, productId, fulfillmentLocationId } = await readySupplier();
    const basePayload = {
      productId,
      fulfillmentLocationId,
      targetQuantity: 100,
      unitPriceAmount: 11.5,
      startAt: new Date(Date.now() + 3600_000).toISOString(),
      endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
      expectedPreparationDays: 3,
    };

    const withMinPurchase = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({ ...basePayload, minPurchaseQuantity: 5 });
    expect(withMinPurchase.status).toBe(400);

    const withMaxPurchase = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({ ...basePayload, maxPurchaseQuantity: 50 });
    expect(withMaxPurchase.status).toBe(400);

    const withSharePercentage = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({ ...basePayload, sharePercentage: 10 });
    expect(withSharePercentage.status).toBe(400);

    // Confirm the SAME payload without the forbidden fields succeeds,
    // proving the 400s above are specifically about the extra fields.
    const clean = await agent.post("/api/v1/companies/me/opportunities").set("Origin", ORIGIN).send(basePayload);
    expect(clean.status).toBe(201);

    // Same rejection on the update (PATCH) path.
    const patchWithForbiddenField = await agent
      .patch(`/api/v1/companies/me/opportunities/${clean.body.id}`)
      .set("Origin", ORIGIN)
      .send({ minPurchaseQuantity: 5 });
    expect(patchWithForbiddenField.status).toBe(400);
  });
});
