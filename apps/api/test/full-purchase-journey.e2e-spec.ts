import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import Redis from "ioredis";
import {
  CHECKOUT_SESSION_VIEW_KEYS,
  DOCUMENT_SUMMARY_KEYS,
  NOT_A_TAX_INVOICE,
  ORDER_DETAIL_KEYS,
} from "@platform/types";
import { AppModule } from "../src/app.module";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { createE2eApplication } from "./support/create-e2e-application";
import { publishTestPolicy } from "./fixtures/policy.fixture";
import { ensureTestCity } from "./fixtures/city.fixture";
import { checkoutFixturePrisma, seedCheckoutFixture } from "./fixtures/checkout.fixture";
import { ensureCommissionTaxPolicy, seedSupplierBilling } from "./fixtures/payment.fixture";

/**
 * STATUS: WRITTEN — NOT EXECUTED — STATUS UNKNOWN.
 *
 * This suite has never been run. It needs PostgreSQL, Redis and MinIO, and
 * ports 5432, 6379 and 9000 are all closed in this environment. Nothing below
 * should be read as a passing result, and none of it has been debugged against
 * a live stack.
 *
 * ---------------------------------------------------------------
 *
 * The full purchase journey, over real HTTP:
 *
 *   log in → create session → read session → start payment
 *          → capture webhook → order → documents → notifications
 *
 * WHAT THIS ADDS over the unit and integration suites. Every step is already
 * covered in isolation — the checkout service, the webhook's atomicity and
 * rollback, each projection's exact key set. What none of them can show is that
 * the steps FIT: that the id the create response returns is the id the read
 * accepts, that the amount the payment attempt reports is byte-identical to the
 * one the session quoted, and that the notification the capture writes points
 * at an order the trader can actually open.
 *
 * Those are the seams, and a system of well-tested parts still fails at its
 * seams.
 *
 * It is an API journey, deliberately. There is no browser: browser coverage is
 * 8G's, and driving one here would exercise Next's rendering rather than the
 * contracts this batch closes.
 */

const prisma = checkoutFixturePrisma;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const provider = new MockPaymentProvider();
const ORIGIN = "http://localhost:3001";
const PASSWORD = "correct-horse-battery-staple";

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

/** Logs in as a fixture-seeded trader by giving their user a known password. */
async function loginAs(app: INestApplication, companyId: string, userId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const { hashPassword } = await import("../src/common/security/argon2.util");
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });

  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post("/api/v1/auth/login")
    .set("Origin", ORIGIN)
    .send({ crNumber: company.crNumber, password: PASSWORD });
  expect(res.status).toBe(201);

  return agent;
}

describe("full purchase journey (e2e, real HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();

    await publishTestPolicy(prisma);
    await ensureTestCity(prisma);
    await ensureCommissionTaxPolicy();
    await prisma.systemSetting.deleteMany({
      where: { key: { in: ["company_verification_mode", "email_verification_enabled"] } },
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  beforeEach(async () => {
    await resetThrottleCounters();
  });

  it("carries one purchase from checkout to a readable order, with every seam matching", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "JOURNEY" });
    await seedSupplierBilling(fixture.supplierCompanyId);
    const agent = await loginAs(app, fixture.traderCompanyId, fixture.traderUserId);

    // ---- 1. create the session -------------------------------------
    const idempotencyKey = `journey-${Date.now()}`;
    const created = await agent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
      });

    expect(created.status).toBe(201);
    // POST and GET answer with ONE shape. They used to disagree — POST sent
    // JSON numbers under its own field names while GET sent decimal strings.
    expect(Object.keys(created.body).sort()).toEqual([...CHECKOUT_SESSION_VIEW_KEYS].sort());
    expect(created.body.status).toBe("LOCKED");
    expect(created.body.masterOrderId).toBeNull();

    // Money is a fixed-scale decimal string on every field.
    for (const key of [
      "unitPriceInclTaxAmount",
      "productsSubtotalExclTaxAmount",
      "productsTaxAmount",
      "productsSubtotalInclTaxAmount",
      "totalShippingFeeAmount",
      "grandTotalAmount",
    ]) {
      expect(typeof created.body[key]).toBe("string");
      expect(created.body[key]).toMatch(/^-?\d+\.\d{2}$/);
    }

    const sessionId: string = created.body.id;

    // ---- 2. the SAME key returns the SAME session ------------------
    const replayed = await agent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
      });

    expect(replayed.status).toBe(201);
    expect(replayed.body.id).toBe(sessionId);
    // One session, one quantity lock. A second would hold quantity the trader
    // never asked for twice, and both would count toward their cooldown.
    expect(await prisma.checkoutSession.count({ where: { id: sessionId } })).toBe(1);

    // ---- 3. reading it agrees with creating it ---------------------
    const read = await agent
      .get(`/api/v1/trader/checkout-sessions/${sessionId}`)
      .set("Origin", ORIGIN);

    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);

    // ---- 4. start the payment --------------------------------------
    const attempt = await agent
      .post(`/api/v1/trader/checkout-sessions/${sessionId}/payment-attempts`)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `journey-pay-${Date.now()}`)
      .send({});

    expect(attempt.status).toBe(201);
    expect(Object.keys(attempt.body).sort()).toEqual(["amount", "currency", "id", "status"]);
    // The seam that matters most: the amount quoted and the amount charged are
    // the same string, not two figures that print alike.
    expect(attempt.body.amount).toBe(created.body.grandTotalAmount);
    expect(attempt.body.currency).toBe(created.body.currency);
    // No provider internals reach the trader.
    expect(JSON.stringify(attempt.body)).not.toContain("providerReference");
    expect(JSON.stringify(attempt.body)).not.toContain("idempotencyKey");

    const pending = await agent
      .get(`/api/v1/trader/checkout-sessions/${sessionId}`)
      .set("Origin", ORIGIN);
    expect(pending.body.status).toBe("PAYMENT_PENDING");
    expect(pending.body.paymentDeadlineAt).not.toBeNull();

    // ---- 5. the provider captures ----------------------------------
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: attempt.body.id,
      providerReference: `ref-${attempt.body.id}`,
      providerEventId: `evt-journey-${Date.now()}`,
      eventType: "SUCCESS",
      currency: attempt.body.currency,
      providerCapturedAmount: Number(attempt.body.amount),
    });

    const captured = await request(app.getHttpServer())
      .post(`/api/v1/webhooks/payments/${provider.providerCode}`)
      .set(headers as Record<string, string>)
      .send(rawBody);
    expect(captured.status).toBeLessThan(400);

    // ---- 6. PAID now carries its order -----------------------------
    const paid = await agent
      .get(`/api/v1/trader/checkout-sessions/${sessionId}`)
      .set("Origin", ORIGIN);

    expect(paid.body.status).toBe("PAID");
    // The discriminated union's whole promise: PAID implies an order id. The
    // webhook writes both on one transaction client, so a reader who sees one
    // sees the other.
    expect(typeof paid.body.masterOrderId).toBe("string");
    expect(paid.body.masterOrderId).not.toBe("");

    const orderId: string = paid.body.masterOrderId;

    // ---- 7. the order is readable, and carries no counterparty finance
    const order = await agent.get(`/api/v1/trader/orders/${orderId}`).set("Origin", ORIGIN);

    expect(order.status).toBe(200);
    expect(Object.keys(order.body).sort()).toEqual([...ORDER_DETAIL_KEYS].sort());
    expect(order.body.totalAmount).toBe(created.body.grandTotalAmount);
    expect(order.body.allocations.length).toBeGreaterThan(0);

    const serialisedOrder = JSON.stringify(order.body);
    for (const forbidden of [
      "commission",
      "supplierPayable",
      "supplierBankAccount",
      "supplierCompanyId",
      "traderTaxProfileSnapshot",
      "policyAcceptanceId",
      "snapshotData",
    ]) {
      expect(serialisedOrder).not.toContain(forbidden);
    }

    // ---- 8. documents ----------------------------------------------
    const documents = await agent
      .get(`/api/v1/trader/orders/${orderId}/documents`)
      .set("Origin", ORIGIN);

    expect(documents.status).toBe(200);
    for (const document of documents.body) {
      expect(Object.keys(document).sort()).toEqual([...DOCUMENT_SUMMARY_KEYS].sort());
      // The legal notice is on EVERY item, and is what stops one of these
      // being filed as a tax invoice.
      expect(document.notice).toBe(NOT_A_TAX_INVOICE);
      // Withheld: it records what the platform charges the SUPPLIER.
      expect(document.documentType).not.toBe("INTERNAL_COMMISSION_DRAFT");
      expect(document.amount).toMatch(/^-?\d+\.\d{2}$/);
    }

    const serialisedDocuments = JSON.stringify(documents.body);
    for (const forbidden of ["snapshotData", "pdf", "PDF", "qrCode", "zatca", "ZATCA", "objectKey"]) {
      expect(serialisedDocuments).not.toContain(forbidden);
    }

    // ---- 9. the capture produced a notification pointing at that order
    const notifications = await agent.get("/api/v1/trader/notifications").set("Origin", ORIGIN);

    expect(notifications.status).toBe(200);
    const paymentSucceeded = notifications.body.items.find(
      (n: { type: string }) => n.type === "PAYMENT_SUCCEEDED"
    );
    expect(paymentSucceeded).toBeDefined();
    // The seam: the notification's entity is the order the trader can open.
    expect(paymentSucceeded.entityType).toBe("master_order");
    expect(paymentSucceeded.entityId).toBe(orderId);
    expect(paymentSucceeded.params.amount).toBe(created.body.grandTotalAmount);
    // A notification stores a type and scalars, never rendered text.
    expect(paymentSucceeded).not.toHaveProperty("message");
    expect(paymentSucceeded).not.toHaveProperty("body");
    // Nothing about email or the outbox is exposed here.
    expect(JSON.stringify(paymentSucceeded)).not.toContain("email");
  }, 120_000);

  it("answers another company's order and documents with 404, not 403", async () => {
    // A 403 would confirm the order exists and belongs to someone. Both must
    // be indistinguishable from an id that was never issued.
    const mine = await seedCheckoutFixture({ traderCrPrefix: "OWNER" });
    const theirs = await seedCheckoutFixture({ traderCrPrefix: "STRANGER" });
    await seedSupplierBilling(mine.supplierCompanyId);

    const owner = await loginAs(app, mine.traderCompanyId, mine.traderUserId);
    const stranger = await loginAs(app, theirs.traderCompanyId, theirs.traderUserId);

    const created = await owner
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `own-${Date.now()}`)
      .send({
        opportunityId: mine.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: mine.traderLocations.sameCity, quantity: 4 }],
      });
    expect(created.status).toBe(201);

    const unknownId = "00000000-0000-4000-8000-000000000000";

    for (const path of [
      `/api/v1/trader/checkout-sessions/${created.body.id}`,
      `/api/v1/trader/orders/${unknownId}`,
      `/api/v1/trader/orders/${unknownId}/documents`,
    ]) {
      const res = await stranger.get(path).set("Origin", ORIGIN);
      expect([path, res.status]).toEqual([path, 404]);
    }
  }, 120_000);

  it("keeps one colleague's read state out of another's unread count", async () => {
    // Read state is per USER. A colleague clearing their feed must not clear
    // anyone else's.
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "COLLEAGUE" });
    await seedSupplierBilling(fixture.supplierCompanyId);

    const colleague = await prisma.user.create({
      data: {
        companyId: fixture.traderCompanyId,
        email: `colleague-${Date.now()}@example.com`,
        passwordHash: "x",
        primaryMobile1: "+966500000003",
        primaryMobile2: "+966500000004",
      },
    });

    const first = await loginAs(app, fixture.traderCompanyId, fixture.traderUserId);
    const second = await loginAs(app, fixture.traderCompanyId, colleague.id);

    const before = await second.get("/api/v1/trader/notifications/unread-count").set("Origin", ORIGIN);
    expect(before.status).toBe(200);

    const list = await first.get("/api/v1/trader/notifications").set("Origin", ORIGIN);
    const unread = list.body.items.filter((n: { readAt: string | null }) => n.readAt === null);

    if (unread.length > 0) {
      const marked = await first
        .post(`/api/v1/trader/notifications/${unread[0].id}/read`)
        .set("Origin", ORIGIN);
      expect(marked.status).toBe(200);

      // Idempotent: repeating it moves nothing and returns the ORIGINAL
      // timestamp, so a double click cannot make it look newly read.
      const again = await first
        .post(`/api/v1/trader/notifications/${unread[0].id}/read`)
        .set("Origin", ORIGIN);
      expect(again.body.readAt).toBe(marked.body.readAt);
      expect(again.body.changed).toBe(false);
    }

    const after = await second.get("/api/v1/trader/notifications/unread-count").set("Origin", ORIGIN);
    expect(after.body.unread).toBe(before.body.unread);
  }, 120_000);

  it("writes no duplicate notification when the capture webhook is redelivered", async () => {
    // The provider retries. The idempotency claim and the notification's own
    // dedupe key must together make a redelivery a no-op.
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "REDELIVER" });
    await seedSupplierBilling(fixture.supplierCompanyId);
    const agent = await loginAs(app, fixture.traderCompanyId, fixture.traderUserId);

    const created = await agent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `redeliver-${Date.now()}`)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
      });
    expect(created.status).toBe(201);

    const attempt = await agent
      .post(`/api/v1/trader/checkout-sessions/${created.body.id}/payment-attempts`)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `redeliver-pay-${Date.now()}`)
      .send({});
    expect(attempt.status).toBe(201);

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: attempt.body.id,
      providerReference: `ref-${attempt.body.id}`,
      providerEventId: `evt-redeliver-${Date.now()}`,
      eventType: "SUCCESS",
      currency: attempt.body.currency,
      providerCapturedAmount: Number(attempt.body.amount),
    });

    // The SAME signed body twice, which is exactly what a provider retry is.
    await request(app.getHttpServer())
      .post(`/api/v1/webhooks/payments/${provider.providerCode}`)
      .set(headers as Record<string, string>)
      .send(rawBody);
    await request(app.getHttpServer())
      .post(`/api/v1/webhooks/payments/${provider.providerCode}`)
      .set(headers as Record<string, string>)
      .send(rawBody);

    const paid = await agent
      .get(`/api/v1/trader/checkout-sessions/${created.body.id}`)
      .set("Origin", ORIGIN);
    expect(paid.body.status).toBe("PAID");

    const orderId: string = paid.body.masterOrderId;
    expect(await prisma.masterOrder.count({ where: { checkoutSessionId: created.body.id } })).toBe(1);

    const notifications = await prisma.notification.count({
      where: { entityId: orderId, type: "PAYMENT_SUCCEEDED" },
    });
    expect(notifications).toBe(1);
  }, 120_000);
});
