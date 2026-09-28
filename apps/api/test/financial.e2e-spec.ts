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
import { uniqueVatNumber } from "./fixtures/unique";

// ONE NUMBER PER RUN, shared by every write and every assertion in
// this file. `*_tax_profiles.vat_number` is UNIQUE, so a literal
// here collided with the same literal in a sibling spec — and with
// the rows every previous run left behind.
const SUPPLIER_VAT = uniqueVatNumber();


const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";
const VALID_IBAN = "SA0380000000608010167519";

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

function randomCr(): string {
  return `CR-FIN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getActivePolicyIds(app: INestApplication): Promise<string[]> {
  const res = await request(app.getHttpServer()).get("/api/v1/policies/active").set("Origin", ORIGIN);
  return res.body.map((p: { id: string }) => p.id);
}

async function registerVerifiedSupplier(app: INestApplication) {
  const acceptedPolicyVersionIds = await getActivePolicyIds(app);
  const crNumber = randomCr();
  const password = "correct-horse-battery-staple";
  const payload = {
    crNumber,
    legalName: "Financial Test Supplier",
    email: `supplier-fin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    password,
    primaryMobile1: uniqueMobile(),
    acceptedPolicyVersionIds,
  };
  await request(app.getHttpServer())
    .post("/api/v1/auth/register/supplier")
    .set("Origin", ORIGIN)
    .send(payload);
  await prisma.company.updateMany({
    where: { crNumber },
    data: { verificationStatus: "VERIFIED" },
  });
  return { crNumber, password };
}

async function loginAgent(app: INestApplication, crNumber: string, password: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ crNumber, password });
  return agent;
}

async function createAuthenticatedAdminAgent(app: INestApplication) {
  const email = `admin-fin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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

describe("Financial Readiness (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);

    await publishTestPolicy(prisma);
    // The city is no longer part of registration, but the suite still
    // needs one to exist for the branches it creates later.
    await ensureTestCity(prisma);
    await prisma.systemSetting.deleteMany({
      where: { key: { in: ["company_verification_mode", "email_verification_enabled"] } },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  beforeEach(async () => {
    await resetThrottleCounters();
  });

  describe("Access gate", () => {
    it("a non-verified supplier is rejected with SUPPLIER_NOT_VERIFIED on every financial endpoint", async () => {
      const acceptedPolicyVersionIds = await getActivePolicyIds(app);
      const crNumber = randomCr();
      const password = "correct-horse-battery-staple";
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/supplier")
        .set("Origin", ORIGIN)
        .send({
          crNumber,
          legalName: "Unverified Supplier",
          email: `unverified-${Date.now()}@example.com`,
          password,
          primaryMobile1: uniqueMobile(),
          acceptedPolicyVersionIds,
        });
      const agent = await loginAgent(app, crNumber, password);

      const res = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "X", iban: VALID_IBAN });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("SUPPLIER_NOT_VERIFIED");
    });
  });

  describe("The bank is the IBAN's to name", () => {
    /**
     * ONE SOURCE FOR ONE FACT. `bankName` used to be free text beside
     * the IBAN, so a supplier could type an Al Rajhi number under
     * "Riyad Bank" and the platform would store the contradiction.
     * The field is gone from the contract, and the global
     * `forbidNonWhitelisted` pipe is what says so.
     */
    it("refuses a request that still tries to name the bank", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const res = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({
          accountHolderName: "Holder",
          bankName: "بنك الرياض",
          iban: VALID_IBAN,
        });

      expect(res.status).toBe(400);
    });

    it("refuses an IBAN whose checksum does not agree, before writing anything", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const res = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        // The last digit of VALID_IBAN changed.
        .send({ accountHolderName: "Holder", iban: "SA0380000000608010167518" });

      expect(res.status).toBe(400);

      const list = await agent
        .get("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN);
      expect(list.body).toHaveLength(0);
    });
  });

  describe("Bank account submission and approval", () => {
    it("submits a bank account, admin approves it, financial-readiness reflects it, IBAN never appears raw", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);
      const adminAgent = await createAuthenticatedAdminAgent(app);

      const submitRes = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "Holder", iban: VALID_IBAN });
      expect(submitRes.status).toBe(201);
      expect(submitRes.body.ibanLast4).toBe("7519");
      // The bank was never sent — it was read out of the IBAN. Code 80
      // is Al Rajhi.
      expect(submitRes.body.bankName).toBe("مصرف الراجحي");
      expect(JSON.stringify(submitRes.body)).not.toContain(VALID_IBAN);

      const pending = await adminAgent
        .get("/api/v1/admin/bank-accounts/pending-review")
        .set("Origin", ORIGIN);
      expect(pending.status).toBe(200);
      expect(JSON.stringify(pending.body)).not.toContain(VALID_IBAN);

      const approve = await adminAgent
        .post(`/api/v1/admin/bank-accounts/${submitRes.body.id}/approve`)
        .set("Origin", ORIGIN);
      expect(approve.status).toBe(201);

      const readiness = await agent.get("/api/v1/companies/me/financial-readiness").set("Origin", ORIGIN);
      expect(readiness.body.hasVerifiedBankAccount).toBe(true);
      expect(readiness.body.isReady).toBe(false);

      const company = await prisma.company.findUniqueOrThrow({ where: { crNumber: supplier.crNumber } });
      expect(company.activeBankAccountId).toBe(submitRes.body.id);
      expect(company.payoutHoldUntil).not.toBeNull();
    });

    it("completing tax and invoicing profiles makes the supplier fully financially ready", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);
      const adminAgent = await createAuthenticatedAdminAgent(app);

      const submitRes = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "Holder", iban: VALID_IBAN });
      await adminAgent
        .post(`/api/v1/admin/bank-accounts/${submitRes.body.id}/approve`)
        .set("Origin", ORIGIN);

      await agent
        .put("/api/v1/companies/me/tax-profile")
        .set("Origin", ORIGIN)
        .send({ isVatRegistered: false });
      await agent
        .put("/api/v1/companies/me/invoicing-profile")
        .set("Origin", ORIGIN)
        .send({ invoicingLegalName: "Financial Test Supplier LLC" });

      const readiness = await agent.get("/api/v1/companies/me/financial-readiness").set("Origin", ORIGIN);
      expect(readiness.body.isReady).toBe(true);
    });

    it("rejecting a submission sets REJECTED with reason, and does not touch the active bank account", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);
      const adminAgent = await createAuthenticatedAdminAgent(app);

      const submitRes = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "Holder", iban: VALID_IBAN });

      const reject = await adminAgent
        .post(`/api/v1/admin/bank-accounts/${submitRes.body.id}/reject`)
        .set("Origin", ORIGIN)
        .send({ reason: "Account holder name mismatch" });
      expect(reject.status).toBe(201);

      const list = await agent.get("/api/v1/companies/me/bank-account").set("Origin", ORIGIN);
      const rejected = list.body.find((b: { id: string }) => b.id === submitRes.body.id);
      expect(rejected.verificationStatus).toBe("REJECTED");

      const company = await prisma.company.findUniqueOrThrow({ where: { crNumber: supplier.crNumber } });
      expect(company.activeBankAccountId).toBeNull();
    });

    it("cannot submit a second bank account while one is already pending review", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "Holder", iban: VALID_IBAN });

      const second = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "Holder2", iban: "SA7380000000608010167520" });
      expect(second.status).toBe(409);
    });

    it("changing bank accounts (submit + approve a second one) supersedes the first — full history retained, never deleted", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);
      const adminAgent = await createAuthenticatedAdminAgent(app);

      const first = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "Holder1", iban: VALID_IBAN });
      await adminAgent.post(`/api/v1/admin/bank-accounts/${first.body.id}/approve`).set("Origin", ORIGIN);

      const second = await agent
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "Holder2", iban: "SA7380000000608010167520" });
      const approveSecond = await adminAgent
        .post(`/api/v1/admin/bank-accounts/${second.body.id}/approve`)
        .set("Origin", ORIGIN);
      expect(approveSecond.status).toBe(201);

      const list = await agent.get("/api/v1/companies/me/bank-account").set("Origin", ORIGIN);
      const firstRow = list.body.find((b: { id: string }) => b.id === first.body.id);
      const secondRow = list.body.find((b: { id: string }) => b.id === second.body.id);
      expect(firstRow.verificationStatus).toBe("SUPERSEDED");
      expect(secondRow.verificationStatus).toBe("VERIFIED");
      expect(list.body.length).toBeGreaterThanOrEqual(2);

      const company = await prisma.company.findUniqueOrThrow({ where: { crNumber: supplier.crNumber } });
      expect(company.activeBankAccountId).toBe(second.body.id);

      const firstDbRow = await prisma.supplierBankAccount.findUniqueOrThrow({ where: { id: first.body.id } });
      expect(firstDbRow).not.toBeNull();
      expect(firstDbRow.verificationStatus).toBe("SUPERSEDED");
    });
  });

  describe("Cross-company isolation", () => {
    it("supplier B cannot see or act on supplier A's bank account history", async () => {
      const supplierA = await registerVerifiedSupplier(app);
      const agentA = await loginAgent(app, supplierA.crNumber, supplierA.password);
      await agentA
        .post("/api/v1/companies/me/bank-account")
        .set("Origin", ORIGIN)
        .send({ accountHolderName: "A Holder", iban: VALID_IBAN });

      const supplierB = await registerVerifiedSupplier(app);
      const agentB = await loginAgent(app, supplierB.crNumber, supplierB.password);

      const listB = await agentB.get("/api/v1/companies/me/bank-account").set("Origin", ORIGIN);
      expect(listB.body).toEqual([]);

      const readinessB = await agentB
        .get("/api/v1/companies/me/financial-readiness")
        .set("Origin", ORIGIN);
      expect(readinessB.body.hasVerifiedBankAccount).toBe(false);
    });
  });

  describe("Tax profile validation", () => {
    it("rejects isVatRegistered=true without a valid vatNumber", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const res = await agent
        .put("/api/v1/companies/me/tax-profile")
        .set("Origin", ORIGIN)
        .send({ isVatRegistered: true });
      expect(res.status).toBe(400);
    });

    it("rejects isVatRegistered=false with a vatNumber present (contradictory)", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const res = await agent
        .put("/api/v1/companies/me/tax-profile")
        .set("Origin", ORIGIN)
        .send({ isVatRegistered: false, vatNumber: SUPPLIER_VAT });
      expect(res.status).toBe(400);
    });

    it("accepts a valid VAT-registered profile", async () => {
      const supplier = await registerVerifiedSupplier(app);
      const agent = await loginAgent(app, supplier.crNumber, supplier.password);

      const res = await agent
        .put("/api/v1/companies/me/tax-profile")
        .set("Origin", ORIGIN)
        .send({ isVatRegistered: true, vatNumber: SUPPLIER_VAT });
      expect(res.status).toBe(200);
    });
  });

  describe("Payout hold bounds (admin settings)", () => {
    it("rejects a payout hold of 0 days", async () => {
      const adminAgent = await createAuthenticatedAdminAgent(app);
      const res = await adminAgent
        .put("/api/v1/admin/settings/security/payout-hold-days")
        .set("Origin", ORIGIN)
        .send({ days: 0 });
      expect(res.status).toBe(400);
    });

    it("accepts a payout hold within [1,30]", async () => {
      const adminAgent = await createAuthenticatedAdminAgent(app);
      const res = await adminAgent
        .put("/api/v1/admin/settings/security/payout-hold-days")
        .set("Origin", ORIGIN)
        .send({ days: 10 });
      expect(res.status).toBe(200);

      const get = await adminAgent
        .get("/api/v1/admin/settings/security/payout-hold-days")
        .set("Origin", ORIGIN);
      expect(get.body.days).toBe(10);
    });
  });
});
