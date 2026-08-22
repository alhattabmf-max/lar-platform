import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { RefundExecutionService } from "../src/refunds/refund-execution.service";
import { RefundWebhookService } from "../src/refunds/refund-webhook.service";
import { RefundProviderRegistry } from "../src/refunds/providers/refund-provider.registry";
import { MockRefundProvider } from "../src/refunds/providers/mock-refund.provider";
import { seedRefundFixture, refundFixturePrisma } from "./fixtures/refund.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = refundFixturePrisma;
const sharedProvider = new MockRefundProvider();

function buildServices(p: PrismaService = prisma as unknown as PrismaService) {
  const registry = new RefundProviderRegistry();
  registry.register(sharedProvider);
  const execution = new RefundExecutionService(p, registry, notificationEvents());
  const webhook = new RefundWebhookService(p, registry, execution, notificationEvents());
  return { execution, webhook, provider: sharedProvider };
}

describe("RefundExecutionService + RefundWebhookService — advanced (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("webhook arriving BEFORE TX2 (attempt still CREATED, no providerReference yet) fills it and completes the refund", async () => {
    const fixture = await seedRefundFixture("REFUNDWHBEFORETX2");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "RETRYABLE_UNKNOWN", reason: "simulating in-flight call" });
    const started = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    const attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: started.refundAttemptId } });
    expect(attempt.providerReference).toBeNull();
    expect(attempt.status).toBe("CREATED");

    const uniqueProviderReference = `prov-ref-early-webhook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: attempt.id,
      providerReference: uniqueProviderReference,
      providerEventId: `evt-early-${attempt.id}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    const result = await webhook.handleWebhook("MOCK_REFUND", rawBody, headers);
    expect(result.processingOutcome).toBe("SUCCEEDED");

    const finalAttempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(finalAttempt.status).toBe("SUCCEEDED");
    expect(finalAttempt.providerReference).toBe(uniqueProviderReference);
    const obligation = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(obligation.status).toBe("COMPLETED");
  }, 30_000);

  it("SUCCESS webhook arriving after a DEFINITIVE_FAILED attempt is accepted as financial truth and completes the refund", async () => {
    const __ref_1 = `prov-ref-late-success-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDSUCCESSAFTERFAIL");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "DEFINITIVE_FAILURE", reason: "declined" });
    const failedResult = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    expect(failedResult.outcome).toBe("DEFINITIVE_FAILED");

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: failedResult.refundAttemptId,
      providerReference: __ref_1,
      providerEventId: `evt-late-success-${failedResult.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    const result = await webhook.handleWebhook("MOCK_REFUND", rawBody, headers);
    expect(result.processingOutcome).toBe("SUCCEEDED");

    const attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: failedResult.refundAttemptId } });
    expect(attempt.status).toBe("SUCCEEDED");
    const obligation = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(obligation.status).toBe("COMPLETED");
  }, 30_000);

  it("FAILURE webhook arriving after a SUCCEEDED attempt is ignored as out of order — no state change", async () => {
    const __ref_1 = `prov-ref-already-succeeded-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDFAILUREAFTERSUCCESS");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    const succeeded = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: succeeded.refundAttemptId,
      providerReference: __ref_1,
      providerEventId: `evt-late-failure-${succeeded.refundAttemptId}`,
      eventType: "FAILURE",
      amount: fixture.amount,
    });
    const result = await webhook.handleWebhook("MOCK_REFUND", rawBody, headers);
    expect(result.processingOutcome).toBe("IGNORED_OUT_OF_ORDER");

    const attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: succeeded.refundAttemptId } });
    expect(attempt.status).toBe("SUCCEEDED");
    const obligation = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(obligation.status).toBe("COMPLETED");
  }, 30_000);

  it("a duplicate webhook (identical payload) does not duplicate Ledger/Audit/Outbox entries", async () => {
    const __ref_1 = `prov-ref-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDDUPWEBHOOK");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const sent = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: sent.refundAttemptId,
      providerReference: __ref_1,
      providerEventId: `evt-dup-${sent.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    const first = await webhook.handleWebhook("MOCK_REFUND", rawBody, headers);
    const second = await webhook.handleWebhook("MOCK_REFUND", rawBody, headers);
    expect(second).toEqual(first);

    const journalCount = await prisma.journalEntry.count({ where: { referenceType: "refund_obligation", referenceId: fixture.refundObligationId, eventType: "REFUND_EXECUTED" } });
    expect(journalCount).toBe(1);
    const auditCount = await prisma.auditLog.count({ where: { entityId: fixture.refundObligationId, action: "REFUND_COMPLETED" } });
    expect(auditCount).toBe(1);
    const eventsCount = await prisma.refundProviderEvent.count({ where: { providerEventId: `evt-dup-${sent.refundAttemptId}` } });
    expect(eventsCount).toBe(1);
  }, 30_000);

  it("real concurrent double success on the same obligation via two separate connections produces exactly ONE completion journal entry", async () => {
    const __ref_1 = `prov-ref-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDDOUBLESUCCESS");
    const { execution: executionA, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const attemptResult = await executionA.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    expect(attemptResult.outcome).toBe("PENDING");

    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();
    const registryA = new RefundProviderRegistry();
    const registryB = new RefundProviderRegistry();
    registryA.register(sharedProvider);
    registryB.register(sharedProvider);
    const execA = new RefundExecutionService(prismaA as unknown as PrismaService, registryA, notificationEvents());
    const execB = new RefundExecutionService(prismaB as unknown as PrismaService, registryB, notificationEvents());

    const results = await Promise.allSettled([
      (prismaA as unknown as PrismaClient).$transaction((tx) => execA.completeRefundSuccessTx(tx, attemptResult.refundAttemptId, { requestId: "race-a" })),
      (prismaB as unknown as PrismaClient).$transaction((tx) => execB.completeRefundSuccessTx(tx, attemptResult.refundAttemptId, { requestId: "race-b" })),
    ]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const journalCount = await prisma.journalEntry.count({ where: { referenceType: "refund_obligation", referenceId: fixture.refundObligationId, eventType: "REFUND_EXECUTED" } });
    expect(journalCount).toBe(1);
    const obligation = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(obligation.status).toBe("COMPLETED");
  }, 30_000);

  it("webhook amount mismatch is rejected", async () => {
    const __ref_1 = `prov-ref-amt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDAMOUNTMISMATCH");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const sent = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: sent.refundAttemptId,
      providerReference: __ref_1,
      providerEventId: `evt-amt-${sent.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount + 999,
    });
    await expect(webhook.handleWebhook("MOCK_REFUND", rawBody, headers)).rejects.toThrow();
  }, 30_000);

  it("webhook currency mismatch is rejected", async () => {
    const __ref_1 = `prov-ref-curr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDCURRENCYMISMATCH");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const sent = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: sent.refundAttemptId,
      providerReference: __ref_1,
      providerEventId: `evt-curr-${sent.refundAttemptId}`,
      eventType: "SUCCESS",
      currency: "USD",
      amount: fixture.amount,
    });
    await expect(webhook.handleWebhook("MOCK_REFUND", rawBody, headers)).rejects.toThrow();
  }, 30_000);

  it("a wrong/stale signature is rejected before any DB write", async () => {
    const __ref_1 = `prov-ref-badsig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDBADSIG");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const sent = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: sent.refundAttemptId,
      providerReference: __ref_1,
      providerEventId: `evt-badsig-${sent.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    const tampered = { ...headers, "x-mock-refund-signature": "0".repeat(64) };
    await expect(webhook.handleWebhook("MOCK_REFUND", rawBody, tampered)).rejects.toThrow();

    const events = await prisma.refundProviderEvent.count({ where: { providerEventId: `evt-badsig-${sent.refundAttemptId}` } });
    expect(events).toBe(0);
  }, 30_000);

  it("same providerEventId with a DIFFERENT payload hash is rejected as a security incident", async () => {
    const __ref_1 = `prov-ref-hash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDHASHMISMATCH");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const sent = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    const eventId = `evt-hash-${sent.refundAttemptId}`;

    const first = provider.buildSignedWebhook({
      merchantReference: sent.refundAttemptId,
      providerReference: __ref_1,
      providerEventId: eventId,
      eventType: "FAILURE",
      amount: fixture.amount,
    });
    await webhook.handleWebhook("MOCK_REFUND", first.rawBody, first.headers).catch(() => undefined);

    const second = provider.buildSignedWebhook({
      merchantReference: sent.refundAttemptId,
      providerReference: __ref_1,
      providerEventId: eventId,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    await expect(webhook.handleWebhook("MOCK_REFUND", second.rawBody, second.headers)).rejects.toThrow();
  }, 30_000);

  it("SET CONSTRAINTS IMMEDIATE + direct ledger balance break is rejected at commit", async () => {
    const fixture = await seedRefundFixture("REFUNDLEDGERBREAK");
    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          const journal = await tx.journalEntry.create({
            data: { eventType: "TEST_BREAK", referenceType: "refund_obligation", referenceId: fixture.refundObligationId, idempotencyKey: `test-break-${Date.now()}` },
          });
          await tx.ledgerPosting.createMany({
            data: [
              { journalEntryId: journal.id, account: "CUSTOMER_REFUND_PAYABLE", direction: "DEBIT", amount: 999 },
              { journalEntryId: journal.id, account: "CASH_CLEARING", direction: "CREDIT", amount: 1 },
            ],
          });
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE`);
        });
      })()
    ).rejects.toThrow();
  }, 15_000);
});
