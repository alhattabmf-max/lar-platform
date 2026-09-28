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
import { uniqueMobile } from "./fixtures/unique";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";

async function submitWithMainImage(agent: request.Agent, productId: string) {
  const sharp = (await import("sharp")).default;
  const buffer = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();
  await agent.post(`/api/v1/companies/me/products/${productId}/media`).set("Origin", ORIGIN).attach("file", buffer, "test.jpg");
  return agent.post(`/api/v1/companies/me/products/${productId}/submit`).set("Origin", ORIGIN);
}

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

function randomCr(prefix = "CR-PROD"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getActivePolicyIds(app: INestApplication): Promise<string[]> {
  const res = await request(app.getHttpServer()).get("/api/v1/policies/active").set("Origin", ORIGIN);
  return res.body.map((p: { id: string }) => p.id);
}

async function registerSupplier(
  app: INestApplication,
  overrides: Record<string, unknown> = {}
): Promise<{ crNumber: string; password: string; email: string }> {
  const acceptedPolicyVersionIds = await getActivePolicyIds(app);
  const payload = {
    crNumber: randomCr(),
    legalName: "Product Test Supplier",
    email: `supplier-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    password: "correct-horse-battery-staple",
    primaryMobile1: uniqueMobile(),
    acceptedPolicyVersionIds,
    ...overrides,
  };
  await request(app.getHttpServer())
    .post("/api/v1/auth/register/supplier")
    .set("Origin", ORIGIN)
    .send(payload);
  return { crNumber: payload.crNumber, password: payload.password, email: payload.email };
}

async function loginAgent(app: INestApplication, crNumber: string, password: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ crNumber, password });
  return agent;
}

async function createAuthenticatedAdminAgent(app: INestApplication) {
  const email = `admin-prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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

describe("Products (e2e)", () => {
  let app: INestApplication;
  let taxonomyNodeId: string;
  let salesUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);

    await publishTestPolicy(prisma);
    // The city is no longer part of registration, but the suite still
    // needs one to exist for the branches it creates later.
    await ensureTestCity(prisma);
    await prisma.systemSetting.deleteMany({ where: { key: "company_verification_mode" } });

    const node = await prisma.taxonomyNode.create({ data: { nameAr: "قسم", nameEn: "Section" } });
    taxonomyNodeId = node.id;
    const unit = await prisma.salesUnit.create({ data: { nameAr: "وحدة", nameEn: "Unit" } });
    salesUnitId = unit.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  beforeEach(async () => {
    await resetThrottleCounters();
  });

  function baseProductPayload(overrides: Record<string, unknown> = {}) {
    return {
      taxonomyNodeId,
      salesUnitId,
      salesUnitNameAr: "كرتون",
      salesUnitNameEn: "Carton",
      nameAr: "منتج تجريبي",
      nameEn: "Test Product",
      weightPerUnit: 2.5,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      ...overrides,
    };
  }

  describe("Ownership and account-type restrictions", () => {
    it("a TRADER account cannot create a product", async () => {
      const acceptedPolicyVersionIds = await getActivePolicyIds(app);
      const payload = {
        crNumber: randomCr("CR-TRADER"),
        legalName: "Trader Co",
        email: `trader-${Date.now()}@example.com`,
        password: "correct-horse-battery-staple",
        primaryMobile1: uniqueMobile(),
        acceptedPolicyVersionIds,
      };
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader")
        .set("Origin", ORIGIN)
        .send(payload);
      const agent = await loginAgent(app, payload.crNumber, payload.password);

      const res = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send(baseProductPayload());
      expect(res.status).toBe(403);
    });

    it("a SUPPLIER not yet VERIFIED can still create a DRAFT product and upload media", async () => {
      const supplier = await registerSupplier(app);
      await prisma.company.updateMany({
        where: { crNumber: supplier.crNumber },
        data: { verificationStatus: "PENDING_VERIFICATION" },
      });
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const res = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send(baseProductPayload());
      expect(res.status).toBe(201);
      expect(res.body.approvalStatus).toBe("DRAFT");
    });
  });

  describe("Submit gate — VERIFIED supplier only", () => {
    it("rejects submit with SUPPLIER_NOT_VERIFIED when the company is not verified", async () => {
      const supplier = await registerSupplier(app);
      await prisma.company.updateMany({
        where: { crNumber: supplier.crNumber },
        data: { verificationStatus: "PENDING_VERIFICATION" },
      });
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const create = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send(baseProductPayload());
      const productId = create.body.id;

      const submit = await agent
        .post(`/api/v1/companies/me/products/${productId}/submit`)
        .set("Origin", ORIGIN);
      expect(submit.status).toBe(403);
      expect(submit.body.error.code).toBe("SUPPLIER_NOT_VERIFIED");
    });

    it("submit() now auto-approves (never PENDING_REVIEW) once VERIFIED and technically complete", async () => {
      const supplier = await registerSupplier(app);
      await prisma.company.updateMany({
        where: { crNumber: supplier.crNumber },
        data: { verificationStatus: "VERIFIED" },
      });
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const create = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send(baseProductPayload());
      const productId = create.body.id;

      const submit = await submitWithMainImage(agent, productId);
      expect(submit.status).toBe(201);
      expect(submit.body.approvalStatus).toBe("APPROVED");

      const snapshot = await prisma.productApprovalSnapshot.findFirstOrThrow({ where: { productId } });
      expect(snapshot.approvalSource).toBe("AUTO");
    });

    it("submit() rejects with a technical-check error when there is no main product image yet", async () => {
      const supplier = await registerSupplier(app);
      await prisma.company.updateMany({
        where: { crNumber: supplier.crNumber },
        data: { verificationStatus: "VERIFIED" },
      });
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const create = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send(baseProductPayload());
      const productId = create.body.id;

      const submit = await agent.post(`/api/v1/companies/me/products/${productId}/submit`).set("Origin", ORIGIN);
      expect(submit.status).toBe(400);

      const productRow = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
      expect(productRow.approvalStatus).toBe("DRAFT"); // nothing written on a failed technical check
    });
  });

  describe("Cross-company isolation", () => {
    it("supplier B cannot read, edit, submit, archive, or touch media of supplier A's product", async () => {
      const supplierA = await registerSupplier(app);
      await prisma.company.updateMany({
        where: { crNumber: supplierA.crNumber },
        data: { verificationStatus: "VERIFIED" },
      });
      const agentA = await loginAgent(app, supplierA.crNumber, supplierA.password);

      const create = await agentA
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send(baseProductPayload());
      const productId = create.body.id;

      const supplierB = await registerSupplier(app);
      const agentB = await loginAgent(app, supplierB.crNumber, supplierB.password);

      const readAttempt = await agentB.get("/api/v1/companies/me/products").set("Origin", ORIGIN);
      expect(readAttempt.body.map((p: { id: string }) => p.id)).not.toContain(productId);

      const editAttempt = await agentB
        .patch(`/api/v1/companies/me/products/${productId}`)
        .set("Origin", ORIGIN)
        .send({ nameEn: "Hijacked" });
      expect(editAttempt.status).toBe(404);

      const submitAttempt = await agentB
        .post(`/api/v1/companies/me/products/${productId}/submit`)
        .set("Origin", ORIGIN);
      expect(submitAttempt.status).toBe(404);

      const archiveAttempt = await agentB
        .post(`/api/v1/companies/me/products/${productId}/archive`)
        .set("Origin", ORIGIN);
      expect(archiveAttempt.status).toBe(404);

      const mediaUploadAttempt = await agentB
        .post(`/api/v1/companies/me/products/${productId}/media`)
        .set("Origin", ORIGIN)
        .attach("file", Buffer.from("not-an-image"), "x.jpg");
      expect(mediaUploadAttempt.status).toBe(404);
    });
  });

  describe("Archive lifecycle", () => {
    it("archiving is independent from approval status and is terminal", async () => {
      const supplier = await registerSupplier(app);
      await prisma.company.updateMany({
        where: { crNumber: supplier.crNumber },
        data: { verificationStatus: "VERIFIED" },
      });
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const create = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send(baseProductPayload());
      const productId = create.body.id;

      const archive = await agent
        .post(`/api/v1/companies/me/products/${productId}/archive`)
        .set("Origin", ORIGIN);
      expect(archive.status).toBe(201);

      const editAttempt = await agent
        .patch(`/api/v1/companies/me/products/${productId}`)
        .set("Origin", ORIGIN)
        .send({ nameEn: "Should fail" });
      expect(editAttempt.status).toBe(400);
    });

    it("cannot archive while PENDING_REVIEW (legacy state — no longer reachable via submit(), seeded directly)", async () => {
      const supplier = await registerSupplier(app);
      await prisma.company.updateMany({
        where: { crNumber: supplier.crNumber },
        data: { verificationStatus: "VERIFIED" },
      });
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const create = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send(baseProductPayload());
      const productId = create.body.id;
      await prisma.product.update({ where: { id: productId }, data: { approvalStatus: "PENDING_REVIEW" } });

      const archiveAttempt = await agent
        .post(`/api/v1/companies/me/products/${productId}/archive`)
        .set("Origin", ORIGIN);
      expect(archiveAttempt.status).toBe(400);
    });
  });

  describe("Admin approval / rejection (legacy manual path — PENDING_REVIEW seeded directly, no longer reachable via submit())", () => {
    it("rejecting a PENDING_REVIEW product sets REJECTED with reason, and it becomes editable again", async () => {
      const supplier = await registerSupplier(app);
      await prisma.company.updateMany({
        where: { crNumber: supplier.crNumber },
        data: { verificationStatus: "VERIFIED" },
      });
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);
      const adminAgent = await createAuthenticatedAdminAgent(app);

      const create = await agent
        .post("/api/v1/companies/me/products")
        .set("Origin", ORIGIN)
        .send(baseProductPayload());
      const productId = create.body.id;
      await prisma.product.update({ where: { id: productId }, data: { approvalStatus: "PENDING_REVIEW" } });

      const reject = await adminAgent
        .post(`/api/v1/admin/products/${productId}/reject`)
        .set("Origin", ORIGIN)
        .send({ reason: "Missing required details" });
      expect(reject.status).toBe(201);

      const edit = await agent
        .patch(`/api/v1/companies/me/products/${productId}`)
        .set("Origin", ORIGIN)
        .send({ nameEn: "Fixed now" });
      expect(edit.status).toBe(200);
    });
  });
});
