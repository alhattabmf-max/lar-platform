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
import { ensureTestPlace, type TestPlace } from "./fixtures/city.fixture";
import { createBranch, verifySupplierThroughReview } from "./fixtures/branch.fixture";
import sharp from "sharp";
import { uniqueMobile } from "./fixtures/unique";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";
const VALID_IBAN = "SA0380000000608010167519";

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

function randomCr(prefix: string): string {
  return `CR-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getActivePolicyIds(app: INestApplication): Promise<string[]> {
  const res = await request(app.getHttpServer()).get("/api/v1/policies/active").set("Origin", ORIGIN);
  return res.body.map((p: { id: string }) => p.id);
}

async function registerCompany(app: INestApplication, kind: "supplier" | "trader", prefix: string) {
  const acceptedPolicyVersionIds = await getActivePolicyIds(app);
  const crNumber = randomCr(prefix);
  const password = "correct-horse-battery-staple";
  await request(app.getHttpServer())
    .post(`/api/v1/auth/register/${kind}`)
    .set("Origin", ORIGIN)
    .send({
      crNumber,
      legalName: `7A ${kind}`,
      email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
      password,
      primaryMobile1: uniqueMobile(),
      acceptedPolicyVersionIds,
    });
  await prisma.company.updateMany({ where: { crNumber }, data: { verificationStatus: "VERIFIED" } });
  const agent = request.agent(app.getHttpServer());
  await agent.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ crNumber, password });
  return { agent, crNumber };
}

async function createAuthenticatedAdminAgent(app: INestApplication) {
  const email = `admin-7a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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

describe("Phase 7A — product auto-approval, reports, commission (e2e)", () => {
  let app: INestApplication;
  let place: TestPlace;
  let adminAgent: request.Agent;
  let taxonomyNodeId: string;

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

    const node = await prisma.taxonomyNode.create({ data: { nameAr: "قسم7A", nameEn: "Section7A" } });
    taxonomyNodeId = node.id;

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

  /**
   * A supplier with a complete record that an administrator approved.
   *
   * THE BRANCH IS PART OF BEING READY. Registration no longer creates
   * one, and a record without a branch cannot be submitted for review;
   * the approval is also what activates the bank account, which is why
   * `POST /admin/bank-accounts/:id/approve` no longer exists.
   */
  async function makeFinanciallyReadySupplier() {
    const { agent, crNumber } = await registerCompany(app, "supplier", "SUP7A");
    await agent
      .post("/api/v1/companies/me/bank-account")
      .set("Origin", ORIGIN)
      .send({ accountHolderName: "Holder", iban: VALID_IBAN });
    await agent.put("/api/v1/companies/me/tax-profile").set("Origin", ORIGIN).send({ isVatRegistered: false });
    await agent
      .put("/api/v1/companies/me/invoicing-profile")
      .set("Origin", ORIGIN)
      .send({ invoicingLegalName: "7A Supplier LLC" });
    const branch = await createBranch(agent, ORIGIN, place);
    await verifySupplierThroughReview(agent, adminAgent, ORIGIN, branch.companyId as string);
    return { agent, crNumber, branch };
  }

  async function makeTestJpeg(): Promise<Buffer> {
    return sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg()
      .toBuffer();
  }

  async function submitWithMainImage(agent: request.Agent, productId: string) {
    const buffer = await makeTestJpeg();
    const uploadRes = await agent
      .post(`/api/v1/companies/me/products/${productId}/media`)
      .set("Origin", ORIGIN)
      .attach("file", buffer, "test.jpg");
    expect(uploadRes.status).toBe(201);
    return agent.post(`/api/v1/companies/me/products/${productId}/submit`).set("Origin", ORIGIN);
  }

  const validProductBody = () => ({
    taxonomyNodeId,
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    nameAr: "منتج تجريبي",
    nameEn: "Test Product",
    weightPerUnit: 1,
    lengthCm: 1,
    widthCm: 1,
    heightCm: 1,
  });

  it("submit() auto-approves without any admin review, creating an AUTO snapshot", async () => {
    const { agent } = await makeFinanciallyReadySupplier();
    const createRes = await agent.post("/api/v1/companies/me/products").set("Origin", ORIGIN).send(validProductBody());
    const productId = createRes.body.id;

    const submitRes = await submitWithMainImage(agent, productId);
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.approvalStatus).toBe("APPROVED");

    const snapshot = await prisma.productApprovalSnapshot.findFirstOrThrow({ where: { productId } });
    expect(snapshot.approvalSource).toBe("AUTO");
    expect(snapshot.approvedByAdminId).toBeNull();
    const payload = snapshot.snapshot as Record<string, unknown>;
    expect(payload.salesUnitNameAr).toBe("كرتون");
    expect(payload.salesUnitNameEn).toBe("Carton");
  });

  it("editing an APPROVED product creates a NEW AUTO snapshot without touching the old one", async () => {
    const { agent } = await makeFinanciallyReadySupplier();
    const createRes = await agent.post("/api/v1/companies/me/products").set("Origin", ORIGIN).send(validProductBody());
    const productId = createRes.body.id;
    await submitWithMainImage(agent, productId);

    const firstSnapshot = await prisma.productApprovalSnapshot.findFirstOrThrow({ where: { productId } });

    const updateRes = await agent
      .patch(`/api/v1/companies/me/products/${productId}`)
      .set("Origin", ORIGIN)
      .send({ nameEn: "Updated Test Product" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.approvalStatus).toBe("APPROVED");

    const snapshots = await prisma.productApprovalSnapshot.findMany({
      where: { productId },
      orderBy: { approvedAt: "asc" },
    });
    expect(snapshots.length).toBe(2);
    expect(snapshots[0].id).toBe(firstSnapshot.id);
    expect((snapshots[0].snapshot as Record<string, unknown>).nameEn).toBe("Test Product");
    expect((snapshots[1].snapshot as Record<string, unknown>).nameEn).toBe("Updated Test Product");
  });

  it("full report lifecycle: trader files, admin reviews and dismisses, product untouched throughout", async () => {
    const { agent: supplierAgent } = await makeFinanciallyReadySupplier();
    const createRes = await supplierAgent
      .post("/api/v1/companies/me/products")
      .set("Origin", ORIGIN)
      .send(validProductBody());
    const productId = createRes.body.id;
    await submitWithMainImage(supplierAgent, productId);

    const { agent: traderAgent } = await registerCompany(app, "trader", "TRD7A");

    const supplierAsTraderAttempt = await supplierAgent
      .post("/api/v1/trader/product-reports")
      .set("Origin", ORIGIN)
      .send({ productId, reasonCode: "MISLEADING_INFO" });
    expect(supplierAsTraderAttempt.status).toBe(403);

    const reportRes = await traderAgent
      .post("/api/v1/trader/product-reports")
      .set("Origin", ORIGIN)
      .send({ productId, reasonCode: "MISLEADING_INFO" });
    expect(reportRes.status).toBe(201);
    expect(reportRes.body.status).toBe("OPEN");

    const duplicateRes = await traderAgent
      .post("/api/v1/trader/product-reports")
      .set("Origin", ORIGIN)
      .send({ productId, reasonCode: "SAFETY_CONCERN" });
    expect(duplicateRes.status).toBe(409);

    const productAfterReport = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(productAfterReport.approvalStatus).toBe("APPROVED");

    const dismissRes = await adminAgent
      .post(`/api/v1/admin/products/reports/${reportRes.body.id}/dismiss`)
      .set("Origin", ORIGIN)
      .send({ note: "Not substantiated" });
    expect(dismissRes.status).toBe(201);
    expect(dismissRes.body.status).toBe("DISMISSED");

    const productAfterDismiss = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(productAfterDismiss.approvalStatus).toBe("APPROVED");
  });

  it("admin suspend -> SCHEDULED opportunities become ACTION_REQUIRED, ACTIVE become PAUSED; reactivate does not auto-resume opportunities", async () => {
    const { agent, branch } = await makeFinanciallyReadySupplier();
    const createRes = await agent.post("/api/v1/companies/me/products").set("Origin", ORIGIN).send(validProductBody());
    const productId = createRes.body.id;
    await submitWithMainImage(agent, productId);

    const fulfillmentLocationId = branch.id;

    const activeCreate = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId,
        targetQuantity: 40,
        unitPriceAmount: 10,
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt: new Date(Date.now() + 5 * 24 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    const activePublish = await agent
      .post(`/api/v1/companies/me/opportunities/${activeCreate.body.id}/publish`)
      .set("Origin", ORIGIN);
    expect(activePublish.body.status).toBe("ACTIVE");

    const scheduledCreate = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId,
        targetQuantity: 40,
        unitPriceAmount: 10,
        startAt: new Date(Date.now() + 3600_000).toISOString(),
        endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    const scheduledPublish = await agent
      .post(`/api/v1/companies/me/opportunities/${scheduledCreate.body.id}/publish`)
      .set("Origin", ORIGIN);
    expect(scheduledPublish.body.status).toBe("SCHEDULED");

    const suspendRes = await adminAgent
      .post(`/api/v1/admin/products/${productId}/suspend`)
      .set("Origin", ORIGIN)
      .send({ reason: "Report confirmed" });
    expect(suspendRes.status).toBe(201);

    const activeAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeCreate.body.id } });
    expect(activeAfter.status).toBe("PAUSED");
    const scheduledAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: scheduledCreate.body.id } });
    expect(scheduledAfter.status).toBe("ACTION_REQUIRED");
    expect(scheduledAfter.reasonCode).toBe("PRODUCT_SUSPENDED");

    const reactivateRes = await adminAgent
      .post(`/api/v1/admin/products/${productId}/reactivate`)
      .set("Origin", ORIGIN);
    expect(reactivateRes.status).toBe(201);

    const activeAfterReactivate = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeCreate.body.id } });
    expect(activeAfterReactivate.status).toBe("PAUSED");
    const scheduledAfterReactivate = await prisma.opportunity.findUniqueOrThrow({
      where: { id: scheduledCreate.body.id },
    });
    expect(scheduledAfterReactivate.status).toBe("ACTION_REQUIRED");
  });

  it("admin close() is permanent — cannot be reactivated", async () => {
    const { agent } = await makeFinanciallyReadySupplier();
    const createRes = await agent.post("/api/v1/companies/me/products").set("Origin", ORIGIN).send(validProductBody());
    const productId = createRes.body.id;
    await submitWithMainImage(agent, productId);

    const closeRes = await adminAgent
      .post(`/api/v1/admin/products/${productId}/close`)
      .set("Origin", ORIGIN)
      .send({ reason: "Safety violation" });
    expect(closeRes.status).toBe(201);

    const reactivateAttempt = await adminAgent
      .post(`/api/v1/admin/products/${productId}/reactivate`)
      .set("Origin", ORIGIN);
    expect(reactivateAttempt.status).toBe(409);

    const editAttempt = await agent
      .patch(`/api/v1/companies/me/products/${productId}`)
      .set("Origin", ORIGIN)
      .send({ nameEn: "Trying to edit" });
    expect(editAttempt.status).toBe(400);
  });

  it("commission policy: admin sets a new Append-Only version, bounded 0..10000, previously-published opportunities keep their original rate", async () => {
    const { agent, branch } = await makeFinanciallyReadySupplier();
    const createRes = await agent.post("/api/v1/companies/me/products").set("Origin", ORIGIN).send(validProductBody());
    const productId = createRes.body.id;
    await submitWithMainImage(agent, productId);

    const oppCreate = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId: branch.id,
        targetQuantity: 40,
        unitPriceAmount: 10,
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt: new Date(Date.now() + 5 * 24 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    const oppPublish = await agent
      .post(`/api/v1/companies/me/opportunities/${oppCreate.body.id}/publish`)
      .set("Origin", ORIGIN);
    expect(oppPublish.status).toBe(201);

    const beforeRow = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppCreate.body.id } });
    expect(beforeRow.commissionRateBasisPoints).toBe(500);

    const setRes = await adminAgent
      .put("/api/v1/admin/settings/commission")
      .set("Origin", ORIGIN)
      .send({ rateBasisPoints: 700 });
    expect(setRes.status).toBe(200);
    expect(setRes.body.rateBasisPoints).toBe(700);
    expect(setRes.body.version).toBeGreaterThan(1);

    const outOfBounds = await adminAgent
      .put("/api/v1/admin/settings/commission")
      .set("Origin", ORIGIN)
      .send({ rateBasisPoints: 10001 });
    expect(outOfBounds.status).toBe(400);

    const afterRow = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppCreate.body.id } });
    expect(afterRow.commissionRateBasisPoints).toBe(500);

    await adminAgent.put("/api/v1/admin/settings/commission").set("Origin", ORIGIN).send({ rateBasisPoints: 500 });
  });

  it("publishing reads sales unit + package content from the SNAPSHOT, not the live (since-edited) product", async () => {
    const { agent, branch } = await makeFinanciallyReadySupplier();
    const createRes = await agent
      .post("/api/v1/companies/me/products")
      .set("Origin", ORIGIN)
      .send({
        ...validProductBody(),
        packageContentQuantity: 24,
        packageContentUnitNameAr: "علبة",
        packageContentUnitNameEn: "Can",
      });
    const productId = createRes.body.id;
    await submitWithMainImage(agent, productId);

    await agent
      .patch(`/api/v1/companies/me/products/${productId}`)
      .set("Origin", ORIGIN)
      .send({ salesUnitNameAr: "صندوق", salesUnitNameEn: "Box" });

    const oppCreate = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId: branch.id,
        targetQuantity: 40,
        unitPriceAmount: 10,
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt: new Date(Date.now() + 5 * 24 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    const oppPublish = await agent
      .post(`/api/v1/companies/me/opportunities/${oppCreate.body.id}/publish`)
      .set("Origin", ORIGIN);
    expect(oppPublish.status).toBe(201);

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppCreate.body.id } });
    expect(row.salesUnitNameAr).toBe("صندوق");
    expect(row.salesUnitNameEn).toBe("Box");
    expect(row.packageContentQuantity?.toNumber()).toBe(24);
    expect(row.packageContentUnitNameEn).toBe("Can");

    await agent
      .patch(`/api/v1/companies/me/products/${productId}`)
      .set("Origin", ORIGIN)
      .send({ salesUnitNameAr: "كيس", salesUnitNameEn: "Bag" });

    const rowAfterLaterEdit = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppCreate.body.id } });
    expect(rowAfterLaterEdit.salesUnitNameAr).toBe("صندوق");
    expect(rowAfterLaterEdit.salesUnitNameEn).toBe("Box");
  });

  it("historical compatibility: publishing against a LEGACY-shape snapshot (salesUnitId only, no salesUnitNameAr/En) resolves the name live without ever rewriting the immutable snapshot", async () => {
    const { agent, branch } = await makeFinanciallyReadySupplier();
    const createRes = await agent.post("/api/v1/companies/me/products").set("Origin", ORIGIN).send(validProductBody());
    const productId = createRes.body.id;
    await submitWithMainImage(agent, productId);

    // Simulate a pre-7A snapshot: only salesUnitId, no names, no
    // package content — exactly the shape isLegacySnapshotShape()
    // detects. Seeded as a brand new row (never mutating the real
    // AUTO snapshot submit() already created), matching how a real
    // pre-7A snapshot would have looked at the time it was made.
    const unit = await prisma.salesUnit.create({ data: { nameAr: "وحدة قديمة", nameEn: "Legacy Unit" } });
    const legacySnapshot = await prisma.productApprovalSnapshot.create({
      data: {
        productId,
        approvalSource: "ADMIN",
        approvedByAdminId: crypto.randomUUID(),
        snapshot: { salesUnitId: unit.id },
      },
    });

    const oppCreate = await agent
      .post("/api/v1/companies/me/opportunities")
      .set("Origin", ORIGIN)
      .send({
        productId,
        fulfillmentLocationId: branch.id,
        targetQuantity: 40,
        unitPriceAmount: 10,
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt: new Date(Date.now() + 5 * 24 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      });
    const oppPublish = await agent
      .post(`/api/v1/companies/me/opportunities/${oppCreate.body.id}/publish`)
      .set("Origin", ORIGIN);
    expect(oppPublish.status).toBe(201);

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppCreate.body.id } });
    expect(row.salesUnitNameAr).toBe("وحدة قديمة");
    expect(row.salesUnitNameEn).toBe("Legacy Unit");
    expect(row.packageContentQuantity).toBeNull();
    expect(row.productApprovalSnapshotId).toBe(legacySnapshot.id);

    // The legacy snapshot itself was NEVER rewritten — still exactly
    // its original shape (append-only, immutable at the DB level).
    const snapshotAfter = await prisma.productApprovalSnapshot.findUniqueOrThrow({ where: { id: legacySnapshot.id } });
    expect(snapshotAfter.snapshot).toEqual({ salesUnitId: unit.id });
  });

  it("report isolation: two traders from two different companies each see ONLY their own report and evidence via listMine, never the other's", async () => {
    const { agent: supplierAgent } = await makeFinanciallyReadySupplier();
    const createRes = await supplierAgent
      .post("/api/v1/companies/me/products")
      .set("Origin", ORIGIN)
      .send(validProductBody());
    const productId = createRes.body.id;
    await submitWithMainImage(supplierAgent, productId);

    const { agent: traderAAgent } = await registerCompany(app, "trader", "TRDA7A");
    const { agent: traderBAgent } = await registerCompany(app, "trader", "TRDB7A");

    const reportA = await traderAAgent
      .post("/api/v1/trader/product-reports")
      .set("Origin", ORIGIN)
      .send({
        productId,
        reasonCode: "MISLEADING_INFO",
        evidence: [{ objectKey: "reports/trader-a/proof.jpg", contentType: "image/jpeg", sizeBytes: 1024 }],
      });
    expect(reportA.status).toBe(201);

    const reportB = await traderBAgent
      .post("/api/v1/trader/product-reports")
      .set("Origin", ORIGIN)
      .send({
        productId,
        reasonCode: "SAFETY_CONCERN",
        evidence: [{ objectKey: "reports/trader-b/proof.jpg", contentType: "image/jpeg", sizeBytes: 2048 }],
      });
    expect(reportB.status).toBe(201);
    expect(reportB.body.id).not.toBe(reportA.body.id);

    const traderAMine = await traderAAgent.get("/api/v1/trader/product-reports/mine").set("Origin", ORIGIN);
    expect(traderAMine.status).toBe(200);
    const traderAIds = traderAMine.body.map((r: { id: string }) => r.id);
    expect(traderAIds).toContain(reportA.body.id);
    expect(traderAIds).not.toContain(reportB.body.id);
    // listMine never exposes evidence at all (admin-only view) — extra
    // confirmation the trader endpoint can't leak evidence either way.
    expect(traderAMine.body.every((r: Record<string, unknown>) => !("evidence" in r))).toBe(true);

    const traderBMine = await traderBAgent.get("/api/v1/trader/product-reports/mine").set("Origin", ORIGIN);
    expect(traderBMine.status).toBe(200);
    const traderBIds = traderBMine.body.map((r: { id: string }) => r.id);
    expect(traderBIds).toContain(reportB.body.id);
    expect(traderBIds).not.toContain(reportA.body.id);

    // The admin view, by contrast, legitimately sees both reports and both evidence sets.
    const adminList = await adminAgent.get("/api/v1/admin/products/reports").set("Origin", ORIGIN);
    expect(adminList.status).toBe(200);
    const adminReportA = adminList.body.find((r: { id: string }) => r.id === reportA.body.id);
    const adminReportB = adminList.body.find((r: { id: string }) => r.id === reportB.body.id);
    expect(adminReportA.evidence[0].objectKey).toBe("reports/trader-a/proof.jpg");
    expect(adminReportB.evidence[0].objectKey).toBe("reports/trader-b/proof.jpg");
  });
});
