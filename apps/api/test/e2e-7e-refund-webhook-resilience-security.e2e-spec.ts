import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { SessionService } from "../src/common/security/session.service";
import { AdminSessionService } from "../src/admin/admin-auth/admin-session.service";
import { RefundProviderRegistry } from "../src/refunds/providers/refund-provider.registry";
import { MockRefundProvider } from "../src/refunds/providers/mock-refund.provider";
import { seedSettlementFixture, settlementFixturePrisma } from "./fixtures/settlement.fixture";

const prisma = settlementFixturePrisma;
const ORIGIN = "http://localhost:3001";
const API = "/api/v1";

async function mintTraderCookie(app: INestApplication, userId: string, companyId: string): Promise<string> {
  const sid = await app.get(SessionService).create({ userId, companyId, accountType: "TRADER" });
  return `sid=${sid}`;
}
async function mintSupplierCookie(app: INestApplication, userId: string, companyId: string): Promise<string> {
  const sid = await app.get(SessionService).create({ userId, companyId, accountType: "SUPPLIER" });
  return `sid=${sid}`;
}
async function mintAdminCookie(app: INestApplication): Promise<string> {
  const asid = await app.get(AdminSessionService).create({ adminUserId: crypto.randomUUID() }, 3600);
  return `asid=${asid}`;
}
const idemKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function postWebhook(app: INestApplication, provider: string, rawBody: Buffer, headers: Record<string, string>) {
  const req = request(app.getHttpServer()).post(`${API}/webhooks/refunds/${provider}`).set("Content-Type", "application/json").set(headers);
  req.write(rawBody);
  return req;
}

/** Sets up a FULL_REFUND dispute through to a real HTTP-started refund attempt, returning the ids needed to drive webhooks. */
async function setupDisputeAndStartAttempt(app: INestApplication, prefix: string) {
  const fixture = await seedSettlementFixture(prefix, 60_000);
  const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
  const supplierUserId = crypto.randomUUID();
  const supplierCookie = await mintSupplierCookie(app, supplierUserId, fixture.supplierCompanyId);
  const adminCookie = await mintAdminCookie(app);

  const openRes = await request(app.getHttpServer())
    .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
    .set("Cookie", traderCookie)
    .set("Origin", ORIGIN)
    .set("Idempotency-Key", idemKey(`${prefix}-open`))
    .send({ reasonCode: "ITEM_NOT_RECEIVED", description: "Testing refund webhook resilience and security paths." });
  const disputeId = openRes.body.id;

  await request(app.getHttpServer())
    .post(`${API}/supplier/disputes/${disputeId}/respond`)
    .set("Cookie", supplierCookie)
    .set("Origin", ORIGIN)
    .set("Idempotency-Key", idemKey(`${prefix}-respond`))
    .send({ responseType: "ACCEPT", description: "We accept full responsibility." });

  await request(app.getHttpServer())
    .post(`${API}/admin/disputes/${disputeId}/decide`)
    .set("Cookie", adminCookie)
    .set("Origin", ORIGIN)
    .set("Idempotency-Key", idemKey(`${prefix}-decide`))
    .send({ decisionType: "FULL_REFUND", reasonNote: "Full refund for resilience testing." });

  const refundObligation = await prisma.refundObligation.findFirstOrThrow({ where: { disputeDecision: { disputeId } } });
  return { fixture, disputeId, adminCookie, refundObligation };
}

describe("E2E — Refund webhook resilience & security (real HTTP throughout)", () => {
  let app: INestApplication;
  let refundRegistry: RefundProviderRegistry;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    refundRegistry = app.get(RefundProviderRegistry);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("a DUPLICATE webhook (same providerEventId, matching hash) returns the SAME processingOutcome, with no additional RefundProviderEvent/Journal/Audit/Outbox rows", async () => {
    const { adminCookie, refundObligation } = await setupDisputeAndStartAttempt(app, "E2EREFUNDDUP");
    const startRes = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("dupstart"))
      .send({ providerCode: "MOCK_REFUND" });

    const provider = refundRegistry.get("MOCK_REFUND") as MockRefundProvider;
    const webhook = provider.buildSignedWebhook({
      merchantReference: startRes.body.refundAttemptId,
      providerReference: startRes.body.providerReference,
      providerEventId: `evt-dup-${startRes.body.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount),
    });

    const first = await postWebhook(app, "MOCK_REFUND", webhook.rawBody, webhook.headers);
    expect(first.status).toBe(200);
    expect(first.body.processingOutcome).toBe("SUCCEEDED");

    const eventCountBefore = await prisma.refundProviderEvent.count();
    const journalCountBefore = await prisma.journalEntry.count();
    const auditCountBefore = await prisma.auditLog.count();
    const outboxCountBefore = await prisma.outboxEvent.count();

    const second = await postWebhook(app, "MOCK_REFUND", webhook.rawBody, webhook.headers);
    expect(second.status).toBe(200);
    expect(second.body.processingOutcome).toBe(first.body.processingOutcome);
    expect(second.body).toEqual(first.body);

    expect(await prisma.refundProviderEvent.count()).toBe(eventCountBefore);
    expect(await prisma.journalEntry.count()).toBe(journalCountBefore);
    expect(await prisma.auditLog.count()).toBe(auditCountBefore);
    expect(await prisma.outboxEvent.count()).toBe(outboxCountBefore);
  }, 20_000);

  it("RETRYABLE_UNKNOWN on startAttempt returns the SAME RefundAttempt.id and idempotencyKey on retry — no duplicate row", async () => {
    const { adminCookie, refundObligation } = await setupDisputeAndStartAttempt(app, "E2EREFUNDRETRY");
    const provider = refundRegistry.get("MOCK_REFUND") as MockRefundProvider;
    provider.setNextExecuteRefundResult({ outcome: "RETRYABLE_UNKNOWN", reason: "simulated network timeout" });

    const firstRes = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("retryunk1"))
      .send({ providerCode: "MOCK_REFUND" });
    expect(firstRes.status).toBe(201);
    expect(firstRes.body.outcome).toBe("RETRYABLE_UNKNOWN");

    const secondRes = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("retryunk2"))
      .send({ providerCode: "MOCK_REFUND" });
    expect(secondRes.status).toBe(201);
    expect(secondRes.body.refundAttemptId).toBe(firstRes.body.refundAttemptId);

    const attemptRow = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: firstRes.body.refundAttemptId } });
    expect(attemptRow.idempotencyKey).toBe(`REFUND_ATTEMPT:${firstRes.body.refundAttemptId}`);

    const attemptCount = await prisma.refundAttempt.count({ where: { refundObligationId: refundObligation.id } });
    expect(attemptCount).toBe(1);
  }, 20_000);

  it("a duplicate SUCCESS on a second attempt after the obligation already COMPLETED: that attempt itself becomes SUCCEEDED, plus ONE Reconciliation Incident + ONE reconciliation journal — not a second execution journal", async () => {
    const { adminCookie, refundObligation } = await setupDisputeAndStartAttempt(app, "E2EREFUNDDUPSUCC");
    const provider = refundRegistry.get("MOCK_REFUND") as MockRefundProvider;

    const attempt1Res = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("dupsucc1"))
      .send({ providerCode: "MOCK_REFUND" });
    const failWebhook = provider.buildSignedWebhook({
      merchantReference: attempt1Res.body.refundAttemptId,
      providerReference: attempt1Res.body.providerReference,
      providerEventId: `evt-fail-${attempt1Res.body.refundAttemptId}`,
      eventType: "FAILURE",
    });
    const failRes = await postWebhook(app, "MOCK_REFUND", failWebhook.rawBody, failWebhook.headers);
    expect(failRes.body.processingOutcome).toBe("DEFINITIVE_FAILED");

    const attempt2Res = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("dupsucc2"))
      .send({ providerCode: "MOCK_REFUND" });
    expect(attempt2Res.body.refundAttemptId).not.toBe(attempt1Res.body.refundAttemptId);
    const succeedWebhook2 = provider.buildSignedWebhook({
      merchantReference: attempt2Res.body.refundAttemptId,
      providerReference: attempt2Res.body.providerReference,
      providerEventId: `evt-succ2-${attempt2Res.body.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount),
    });
    const succeed2Res = await postWebhook(app, "MOCK_REFUND", succeedWebhook2.rawBody, succeedWebhook2.headers);
    expect(succeed2Res.body.processingOutcome).toBe("SUCCEEDED");

    const obligationAfter2 = await prisma.refundObligation.findUniqueOrThrow({ where: { id: refundObligation.id } });
    expect(obligationAfter2.status).toBe("COMPLETED");

    const lateSucceedWebhook1 = provider.buildSignedWebhook({
      merchantReference: attempt1Res.body.refundAttemptId,
      providerReference: attempt1Res.body.providerReference,
      providerEventId: `evt-late-succ1-${attempt1Res.body.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount),
    });
    const lateRes = await postWebhook(app, "MOCK_REFUND", lateSucceedWebhook1.rawBody, lateSucceedWebhook1.headers);
    expect(lateRes.status).toBe(200);
    expect(lateRes.body.processingOutcome).toBe("DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION");

    // The attempt itself becomes SUCCEEDED — financial truth from the provider.
    const attempt1After = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: attempt1Res.body.refundAttemptId } });
    expect(attempt1After.status).toBe("SUCCEEDED");

    const incident = await prisma.refundReconciliationIncident.findFirstOrThrow({ where: { refundAttemptId: attempt1Res.body.refundAttemptId } });
    expect(incident.status).toBe("OPEN");
    const reconciliationJournal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: incident.journalEntryId } });
    expect(reconciliationJournal.eventType).toBe("REFUND_RECONCILIATION");
    const incidentCount = await prisma.refundReconciliationIncident.count({ where: { refundAttemptId: attempt1Res.body.refundAttemptId } });
    expect(incidentCount).toBe(1);
    const reconciliationJournalCount = await prisma.journalEntry.count({ where: { eventType: "REFUND_RECONCILIATION", referenceId: attempt1Res.body.refundAttemptId } });
    expect(reconciliationJournalCount).toBe(1);

    const executionJournalCount = await prisma.journalEntry.count({ where: { referenceType: "refund_obligation", referenceId: refundObligation.id, eventType: "REFUND_EXECUTED" } });
    expect(executionJournalCount).toBe(1);
  }, 20_000);

  it("an invalid signature is rejected with 401, before any DB write", async () => {
    const { adminCookie, refundObligation } = await setupDisputeAndStartAttempt(app, "E2EREFUNDBADSIG");
    const startRes = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("badsig"))
      .send({ providerCode: "MOCK_REFUND" });

    const provider = refundRegistry.get("MOCK_REFUND") as MockRefundProvider;
    const webhook = provider.buildSignedWebhook({
      merchantReference: startRes.body.refundAttemptId,
      providerReference: startRes.body.providerReference,
      providerEventId: `evt-badsig-${startRes.body.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount),
    });
    const tamperedHeaders = { ...webhook.headers, "x-mock-refund-signature": "0".repeat(64) };
    const eventCountBefore = await prisma.refundProviderEvent.count();

    const res = await postWebhook(app, "MOCK_REFUND", webhook.rawBody, tamperedHeaders);
    expect(res.status).toBe(401);
    expect(await prisma.refundProviderEvent.count()).toBe(eventCountBefore);
  }, 20_000);

  it("a stale timestamp is rejected with 401", async () => {
    const { adminCookie, refundObligation } = await setupDisputeAndStartAttempt(app, "E2EREFUNDSTALE");
    const startRes = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("stale"))
      .send({ providerCode: "MOCK_REFUND" });

    const provider = refundRegistry.get("MOCK_REFUND") as MockRefundProvider;
    const webhook = provider.buildSignedWebhook({
      merchantReference: startRes.body.refundAttemptId,
      providerReference: startRes.body.providerReference,
      providerEventId: `evt-stale-${startRes.body.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount),
      timestampOverride: new Date(Date.now() - 60 * 60_000),
    });

    const res = await postWebhook(app, "MOCK_REFUND", webhook.rawBody, webhook.headers);
    expect(res.status).toBe(401);
  }, 20_000);

  it("an UNKNOWN provider is rejected with 404, before any DB write", async () => {
    const eventCountBefore = await prisma.refundProviderEvent.count();
    const res = await postWebhook(app, "SOME_UNKNOWN_PROVIDER", Buffer.from("{}"), { "x-mock-refund-timestamp": "0", "x-mock-refund-signature": "abc" });
    expect(res.status).toBe(404);
    expect(await prisma.refundProviderEvent.count()).toBe(eventCountBefore);
  }, 15_000);

  it("the SAME providerEventId with a DIFFERENT payload hash under a VALID signature is a documented CONFLICT (409, not 401) — no change to Attempt/Obligation/Ledger/Incident, plus a safe security audit entry with no raw payload", async () => {
    const { adminCookie, refundObligation } = await setupDisputeAndStartAttempt(app, "E2EREFUNDHASH");
    const startRes = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("hashmismatch"))
      .send({ providerCode: "MOCK_REFUND" });

    const provider = refundRegistry.get("MOCK_REFUND") as MockRefundProvider;
    const sameEventId = `evt-hashtest-${startRes.body.refundAttemptId}`;
    const webhook1 = provider.buildSignedWebhook({
      merchantReference: startRes.body.refundAttemptId,
      providerReference: startRes.body.providerReference,
      providerEventId: sameEventId,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount),
    });
    const first = await postWebhook(app, "MOCK_REFUND", webhook1.rawBody, webhook1.headers);
    expect(first.status).toBe(200);

    const attemptBefore = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: startRes.body.refundAttemptId } });
    const obligationBefore = await prisma.refundObligation.findUniqueOrThrow({ where: { id: refundObligation.id } });
    const journalCountBefore = await prisma.journalEntry.count();
    const incidentCountBefore = await prisma.refundReconciliationIncident.count();

    // Same event id, VALID signature, but a DIFFERENT amount — a genuinely different payload, different hash.
    const webhook2 = provider.buildSignedWebhook({
      merchantReference: startRes.body.refundAttemptId,
      providerReference: startRes.body.providerReference,
      providerEventId: sameEventId,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount) + 1,
    });
    const second = await postWebhook(app, "MOCK_REFUND", webhook2.rawBody, webhook2.headers);
    expect(second.status).toBe(409);

    // Nothing about the attempt, obligation, ledger, or incidents changed.
    const attemptAfter = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: startRes.body.refundAttemptId } });
    expect(attemptAfter).toEqual(attemptBefore);
    const obligationAfter = await prisma.refundObligation.findUniqueOrThrow({ where: { id: refundObligation.id } });
    expect(obligationAfter).toEqual(obligationBefore);
    expect(await prisma.journalEntry.count()).toBe(journalCountBefore);
    expect(await prisma.refundReconciliationIncident.count()).toBe(incidentCountBefore);

    // A safe security audit entry was written — identifiers only, never the raw payload or signature.
    const auditEntry = await prisma.auditLog.findFirstOrThrow({ where: { action: "REFUND_WEBHOOK_EVENT_ID_HASH_MISMATCH", entityId: sameEventId } });
    const serializedAudit = JSON.stringify(auditEntry);
    expect(serializedAudit).not.toContain(webhook2.headers["x-mock-refund-signature"]);
    expect(auditEntry.beforeData).toBeNull();
    expect(auditEntry.afterData).toBeNull();
  }, 20_000);
});
