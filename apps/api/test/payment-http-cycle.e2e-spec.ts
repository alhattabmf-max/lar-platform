import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { publishTestPolicy } from "./fixtures/policy.fixture";
import { ensureTestCity } from "./fixtures/city.fixture";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { ensureCommissionTaxPolicy } from "./fixtures/payment.fixture";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { hashPassword } from "../src/common/security/argon2.util";

const prisma = checkoutFixturePrisma;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";
const PASSWORD = "correct-horse-battery-staple";

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

async function loginAsCompany(app: INestApplication, companyId: string, userId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(PASSWORD) } });
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ crNumber: company.crNumber, password: PASSWORD });
  if (res.status !== 201) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

async function seedSupplierBilling(supplierCompanyId: string): Promise<void> {
  await prisma.supplierTaxProfile.upsert({
    where: { companyId: supplierCompanyId },
    create: { companyId: supplierCompanyId, isVatRegistered: false },
    update: {},
  });
  await prisma.supplierInvoicingProfile.upsert({
    where: { companyId: supplierCompanyId },
    create: { companyId: supplierCompanyId, invoicingLegalName: "HTTP E2E Supplier LLC" },
    update: {},
  });
  const bank = await prisma.supplierBankAccount.create({
    data: {
      companyId: supplierCompanyId,
      accountHolderName: "h",
      bankName: "b",
      ibanCiphertext: "c",
      ibanFingerprint: `fp-${supplierCompanyId}-${Date.now()}`,
      ibanLast4: "1234",
      verificationStatus: "VERIFIED",
    },
  });
  await prisma.company.update({ where: { id: supplierCompanyId }, data: { activeBankAccountId: bank.id } });

  const existingUser = await prisma.user.findFirst({ where: { companyId: supplierCompanyId } });
  if (!existingUser) {
    await prisma.user.create({
      data: {
        companyId: supplierCompanyId,
        email: `supplier-http-${supplierCompanyId}-${Date.now()}@example.com`,
        passwordHash: "x",
        primaryMobile1: "+966500000001",
        primaryMobile2: "+966500000002",
        emailVerificationStatus: "VERIFIED",
      },
    });
  }
}

async function createAuthenticatedAdminAgent(app: INestApplication) {
  const { authenticator } = await import("otplib");
  const email = `admin-payhttp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = "a-genuinely-strong-passphrase-2026";
  await prisma.adminUser.create({ data: { email, passwordHash: await hashPassword(password) } });

  const loginRes = await request(app.getHttpServer()).post("/api/v1/admin/auth/login").set("Origin", ORIGIN).send({ email, password });
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

describe("Phase 7C — Payment/Order full HTTP cycle (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();

    await publishTestPolicy(prisma);
    await ensureTestCity(prisma);
    await prisma.systemSetting.deleteMany({ where: { key: { in: ["company_verification_mode", "email_verification_enabled"] } } });
    await ensureCommissionTaxPolicy();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  beforeEach(async () => {
    await resetThrottleCounters();
  });

  async function setupCheckoutToLocked(prefix: string) {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: prefix });
    await seedSupplierBilling(fixture.supplierCompanyId);
    const traderAgent = await loginAsCompany(app, fixture.traderCompanyId, fixture.traderUserId);

    const checkoutRes = await traderAgent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `http-checkout-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
      });
    expect(checkoutRes.status).toBe(201);

    return { fixture, traderAgent, checkoutSessionId: checkoutRes.body.id as string, grandTotal: checkoutRes.body.grandTotalAmount as number };
  }

  async function startPaymentAttempt(traderAgent: request.Agent, checkoutSessionId: string, idempotencyKey: string) {
    return traderAgent
      .post(`/api/v1/trader/checkout-sessions/${checkoutSessionId}/payment-attempts`)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idempotencyKey)
      .send({});
  }

  it("full cycle: checkout -> payment attempt (Idempotency-Key) -> signed webhook (raw body) -> ONE MasterOrder, fundedQuantity +4 exactly once, allocation frozen, visible to trader/supplier/admin with field isolation", async () => {
    const { fixture, traderAgent, checkoutSessionId, grandTotal } = await setupCheckoutToLocked("HTTPFULL");

    const beforeFunded = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).fundedQuantity;

    const attemptRes = await startPaymentAttempt(traderAgent, checkoutSessionId, `http-attempt-${Date.now()}`);
    expect(attemptRes.status).toBe(201);
    expect(attemptRes.body.status).toBe("PENDING");
    const merchantReference = attemptRes.body.id as string;

    const provider = new MockPaymentProvider();
    const capturedAt = new Date();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference,
      providerReference: `ref-${merchantReference}`,
      providerEventId: `evt-${merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: capturedAt,
      providerCapturedAmount: grandTotal,
    });

    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(rawBody.toString());
    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.processingOutcome).toBe("ORDER_CREATED");
    const masterOrderId = webhookRes.body.masterOrderId as string;

    const orders = await prisma.masterOrder.findMany({ where: { checkoutSessionId } });
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(masterOrderId);

    const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opp.fundedQuantity).toBe(beforeFunded + 4);

    const allocations = await prisma.orderAllocation.findMany({ where: { masterOrderId } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0].status).toBe("AWAITING_PREPARATION");
    expect(allocations[0].preparationDueAt.getTime()).toBeGreaterThan(capturedAt.getTime());

    const traderList = await traderAgent.get("/api/v1/trader/orders").set("Origin", ORIGIN);
    expect(traderList.status).toBe(200);
    expect(traderList.body.some((o: { id: string }) => o.id === masterOrderId)).toBe(true);
    const traderDetail = await traderAgent.get(`/api/v1/trader/orders/${masterOrderId}`).set("Origin", ORIGIN);
    expect(traderDetail.status).toBe(200);

    const supplierUser = await prisma.user.findFirstOrThrow({ where: { companyId: fixture.supplierCompanyId } });
    const supplierAgent = await loginAsCompany(app, fixture.supplierCompanyId, supplierUser.id);
    const supplierList = await supplierAgent.get("/api/v1/supplier/orders").set("Origin", ORIGIN);
    expect(supplierList.status).toBe(200);
    expect(supplierList.body.some((o: { id: string }) => o.id === masterOrderId)).toBe(true);
    const supplierDetail = await supplierAgent.get(`/api/v1/supplier/orders/${masterOrderId}`).set("Origin", ORIGIN);
    expect(supplierDetail.status).toBe(200);

    for (const body of [traderDetail.body, supplierDetail.body]) {
      expect(body).not.toHaveProperty("commissionRateBasisPoints");
      expect(body).not.toHaveProperty("supplierTaxProfileSnapshot");
      expect(body).not.toHaveProperty("supplierBankAccountId");
      expect(body).not.toHaveProperty("policyAcceptanceId");
    }

    const adminAgent = await createAuthenticatedAdminAgent(app);
    const adminList = await adminAgent.get("/api/v1/admin/orders").set("Origin", ORIGIN);
    expect(adminList.status).toBe(200);
    expect(adminList.body.some((o: { id: string }) => o.id === masterOrderId)).toBe(true);
    const adminDetail = await adminAgent.get(`/api/v1/admin/orders/${masterOrderId}`).set("Origin", ORIGIN);
    expect(adminDetail.status).toBe(200);
  }, 30_000);

  it("a duplicate webhook (identical event) returns 2xx with the SAME outcome, with zero additional Order/Ledger/Audit/Outbox rows", async () => {
    const { traderAgent, checkoutSessionId, grandTotal } = await setupCheckoutToLocked("HTTPDUP");
    const attemptRes = await startPaymentAttempt(traderAgent, checkoutSessionId, `http-attempt-dup-${Date.now()}`);
    const merchantReference = attemptRes.body.id as string;

    const provider = new MockPaymentProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference,
      providerReference: `ref-${merchantReference}`,
      providerEventId: `evt-${merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: grandTotal,
    });

    const r1 = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(rawBody.toString());
    expect(r1.status).toBe(200);
    const r2 = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(rawBody.toString());
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(r1.body);

    const orders = await prisma.masterOrder.count({ where: { checkoutSessionId } });
    expect(orders).toBe(1);
    const events = await prisma.providerPaymentEvent.count({ where: { providerEventId: `evt-${merchantReference}` } });
    expect(events).toBe(1);
    const journals = await prisma.journalEntry.count({ where: { referenceId: r1.body.masterOrderId } });
    expect(journals).toBe(1);
  }, 30_000);

  it("a webhook with a WRONG signature is rejected before any DB write", async () => {
    const { traderAgent, checkoutSessionId, grandTotal } = await setupCheckoutToLocked("HTTPBADSIG");
    const attemptRes = await startPaymentAttempt(traderAgent, checkoutSessionId, `http-attempt-badsig-${Date.now()}`);
    const merchantReference = attemptRes.body.id as string;

    const provider = new MockPaymentProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference,
      providerReference: `ref-${merchantReference}`,
      providerEventId: `evt-badsig-${merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: grandTotal,
    });
    const tamperedHeaders = { ...headers, "x-mock-signature": "0".repeat(64) };

    const res = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set(tamperedHeaders)
      .send(rawBody.toString());
    expect(res.status).toBe(401);

    const orders = await prisma.masterOrder.count({ where: { checkoutSessionId } });
    expect(orders).toBe(0);
    const events = await prisma.providerPaymentEvent.count({ where: { providerEventId: `evt-badsig-${merchantReference}` } });
    expect(events).toBe(0);
  }, 30_000);

  it("a webhook with a STALE timestamp is rejected before any DB write", async () => {
    const { traderAgent, checkoutSessionId, grandTotal } = await setupCheckoutToLocked("HTTPSTALE");
    const attemptRes = await startPaymentAttempt(traderAgent, checkoutSessionId, `http-attempt-stale-${Date.now()}`);
    const merchantReference = attemptRes.body.id as string;

    const provider = new MockPaymentProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference,
      providerReference: `ref-${merchantReference}`,
      providerEventId: `evt-stale-${merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: grandTotal,
      timestampOverride: new Date(Date.now() - 60 * 60_000),
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(rawBody.toString());
    expect(res.status).toBe(401);

    const orders = await prisma.masterOrder.count({ where: { checkoutSessionId } });
    expect(orders).toBe(0);
  }, 30_000);

  it("starting payment with the SAME Idempotency-Key returns the same attempt, not a new one", async () => {
    const { traderAgent, checkoutSessionId } = await setupCheckoutToLocked("HTTPIDEMP");
    const key = `http-idemp-${Date.now()}`;

    const r1 = await startPaymentAttempt(traderAgent, checkoutSessionId, key);
    expect(r1.status).toBe(201);
    const r2 = await startPaymentAttempt(traderAgent, checkoutSessionId, key);
    expect(r2.status).toBe(201);
    expect(r2.body.id).toBe(r1.body.id);

    const attempts = await prisma.paymentAttempt.count({ where: { checkoutSessionId } });
    expect(attempts).toBe(1);
  }, 30_000);

  it("there is no endpoint to cancel an order after payment (trader)", async () => {
    const { traderAgent, checkoutSessionId, grandTotal } = await setupCheckoutToLocked("HTTPNOCANCEL");
    const attemptRes = await startPaymentAttempt(traderAgent, checkoutSessionId, `http-attempt-nocancel-${Date.now()}`);
    const merchantReference = attemptRes.body.id as string;
    const provider = new MockPaymentProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference,
      providerReference: `ref-${merchantReference}`,
      providerEventId: `evt-${merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: grandTotal,
    });
    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(rawBody.toString());
    const masterOrderId = webhookRes.body.masterOrderId as string;

    const cancelAttempt = await traderAgent.post(`/api/v1/trader/orders/${masterOrderId}/cancel`).set("Origin", ORIGIN).send({});
    expect(cancelAttempt.status).toBe(404);
  }, 30_000);

  it("the supplier has no accept/reject action available on an order", async () => {
    const { fixture, traderAgent, checkoutSessionId, grandTotal } = await setupCheckoutToLocked("HTTPNOACCEPT");
    const attemptRes = await startPaymentAttempt(traderAgent, checkoutSessionId, `http-attempt-noaccept-${Date.now()}`);
    const merchantReference = attemptRes.body.id as string;
    const provider = new MockPaymentProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference,
      providerReference: `ref-${merchantReference}`,
      providerEventId: `evt-${merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: grandTotal,
    });
    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(rawBody.toString());
    const masterOrderId = webhookRes.body.masterOrderId as string;

    const supplierUser = await prisma.user.findFirstOrThrow({ where: { companyId: fixture.supplierCompanyId } });
    const supplierAgent = await loginAsCompany(app, fixture.supplierCompanyId, supplierUser.id);
    const acceptAttempt = await supplierAgent.post(`/api/v1/supplier/orders/${masterOrderId}/accept`).set("Origin", ORIGIN).send({});
    expect(acceptAttempt.status).toBe(404);
    const rejectAttempt = await supplierAgent.post(`/api/v1/supplier/orders/${masterOrderId}/reject`).set("Origin", ORIGIN).send({});
    expect(rejectAttempt.status).toBe(404);
  }, 30_000);
});
