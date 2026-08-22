import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { RefundExecutionService } from "../src/refunds/refund-execution.service";
import { RefundWebhookService } from "../src/refunds/refund-webhook.service";
import { RefundProviderRegistry } from "../src/refunds/providers/refund-provider.registry";
import { MockRefundProvider } from "../src/refunds/providers/mock-refund.provider";
import { seedRefundFixture, refundFixturePrisma } from "./fixtures/refund.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = refundFixturePrisma;

function buildServices() {
  const registry = new RefundProviderRegistry();
  const provider = new MockRefundProvider();
  registry.register(provider);
  const execution = new RefundExecutionService(prisma as unknown as PrismaService, registry, notificationEvents());
  const webhook = new RefundWebhookService(prisma as unknown as PrismaService, registry, execution, notificationEvents());
  return { execution, webhook, provider };
}

describe("RefundExecutionService — DB constraints, structural guarantees, duplicate-success reconciliation (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("structural proof: executeRefund()'s own synchronous path can NEVER resurrect a DEFINITIVE_FAILED attempt to SUCCEEDED — only a NEW attempt is ever created after a confirmed failure", async () => {
    const __ref_1 = `prov-ref-new-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDSTRUCTGUARD");
    const { execution, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "DEFINITIVE_FAILURE", reason: "declined" });
    const failed = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    expect(failed.outcome).toBe("DEFINITIVE_FAILED");
    const failedAttemptId = failed.refundAttemptId;

    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    const second = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r2" });
    expect(second.refundAttemptId).not.toBe(failedAttemptId);

    const oldAttempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: failedAttemptId } });
    expect(oldAttempt.status).toBe("DEFINITIVE_FAILED");
  }, 30_000);

  it("DEFINITIVE_FAILED->SUCCEEDED only changes status/providerReference — refundObligationId/providerCode/idempotencyKey/createdAt remain frozen", async () => {
    const __ref_1 = `prov-ref-legal-change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDFROZENFIELDS");
    const { execution, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "DEFINITIVE_FAILURE", reason: "declined" });
    const failed = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    const before = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: failed.refundAttemptId } });

    await prisma.refundAttempt.update({ where: { id: failed.refundAttemptId }, data: { status: "SUCCEEDED", providerReference: __ref_1 } });
    const after = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: failed.refundAttemptId } });
    expect(after.status).toBe("SUCCEEDED");
    expect(after.refundObligationId).toBe(before.refundObligationId);
    expect(after.providerCode).toBe(before.providerCode);
    expect(after.idempotencyKey).toBe(before.idempotencyKey);
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());

    const otherFixture = await seedRefundFixture("REFUNDFROZENFIELDS2");
    await expect(
      prisma.$executeRaw`UPDATE refund_attempts SET refund_obligation_id = ${otherFixture.refundObligationId}::uuid WHERE id = ${failed.refundAttemptId}::uuid`
    ).rejects.toThrow(/frozen fields cannot be modified/);
  }, 30_000);

  it("DB: rejects any transition OUT of SUCCEEDED (terminal, no reversal)", async () => {
    const __ref_1 = `prov-ref-terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDNOSUCCESSREVERSAL");
    const { execution, provider } = buildServices();
    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    const succeeded = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    await expect(
      prisma.$executeRaw`UPDATE refund_attempts SET status = 'PENDING' WHERE id = ${succeeded.refundAttemptId}::uuid`
    ).rejects.toThrow(/invalid or disallowed transition/);
    await expect(
      prisma.$executeRaw`UPDATE refund_attempts SET status = 'DEFINITIVE_FAILED' WHERE id = ${succeeded.refundAttemptId}::uuid`
    ).rejects.toThrow(/invalid or disallowed transition/);
  }, 30_000);

  it("DB: idempotencyKey tampering alongside a status change is rejected", async () => {
    const __ref_1 = `prov-ref-idempkey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDIDEMPKEYFROZEN");
    const { execution, provider } = buildServices();
    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const sent = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    await expect(
      prisma.$executeRaw`UPDATE refund_attempts SET status = 'SUCCEEDED', idempotency_key = 'TAMPERED' WHERE id = ${sent.refundAttemptId}::uuid`
    ).rejects.toThrow(/frozen fields cannot be modified/);
  }, 30_000);

  it("DB: RefundObligation.COMPLETED requires at least one SUCCEEDED RefundAttempt — direct bypass is rejected at deferred COMMIT", async () => {
    const fixture = await seedRefundFixture("REFUNDCOMPLETEDNOATTEMPT");
    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE refund_obligations SET status = 'SENT' WHERE id = ${fixture.refundObligationId}::uuid`;
          await tx.$executeRaw`UPDATE refund_obligations SET status = 'COMPLETED' WHERE id = ${fixture.refundObligationId}::uuid`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_refund_obligation_completed_has_succeeded_attempt IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/requires at least one SUCCEEDED refund_attempts row/);
  }, 15_000);

  it("DB: RefundObligation.COMPLETED requires exactly one REFUND_EXECUTED journal entry — direct bypass (with a real SUCCEEDED attempt but no journal) is rejected", async () => {
    const __ref_1 = `prov-ref-nojournal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDCOMPLETEDNOJOURNAL");
    const { execution, provider } = buildServices();
    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const sent = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE refund_attempts SET status = 'SUCCEEDED' WHERE id = ${sent.refundAttemptId}::uuid`;
          await tx.$executeRaw`UPDATE refund_obligations SET status = 'COMPLETED' WHERE id = ${fixture.refundObligationId}::uuid`;
          await tx.$executeRawUnsafe(
            `SET CONSTRAINTS trg_check_refund_obligation_completed_has_succeeded_attempt, trg_check_refund_obligation_completed_has_executed_journal IMMEDIATE`
          );
        });
      })()
    ).rejects.toThrow(/requires exactly one REFUND_EXECUTED journal entry/);
  }, 15_000);

  it("DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION: a genuinely different attempt succeeding after the obligation is already COMPLETED becomes SUCCEEDED itself, raises an immutable incident, and does not post a second REFUND_EXECUTED journal entry", async () => {
    const __ref_1 = `prov-ref-first-success-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const __ref_2 = `prov-ref-second-distinct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDDUPSUCCESS");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    const first = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    expect(first.outcome).toBe("SUCCEEDED");
    const obligationAfterFirst = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(obligationAfterFirst.status).toBe("COMPLETED");

    const secondAttemptId = crypto.randomUUID();
    await prisma.refundAttempt.create({
      data: {
        id: secondAttemptId,
        refundObligationId: fixture.refundObligationId,
        providerCode: "MOCK_REFUND",
        idempotencyKey: `REFUND_ATTEMPT:${secondAttemptId}`,
        status: "PENDING",
        providerReference: __ref_2,
      },
    });

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: secondAttemptId,
      providerReference: __ref_2,
      providerEventId: `evt-dupsuccess-${secondAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    const result = await webhook.handleWebhook("MOCK_REFUND", rawBody, headers);
    expect(result.processingOutcome).toBe("DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION");

    // The second attempt itself IS a real financial fact — SUCCEEDED, never left FAILED/PENDING.
    const secondAttempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: secondAttemptId } });
    expect(secondAttempt.status).toBe("SUCCEEDED");

    // No second normal REFUND_EXECUTED journal entry was created.
    const journalCount = await prisma.journalEntry.count({
      where: { referenceType: "refund_obligation", referenceId: fixture.refundObligationId, eventType: "REFUND_EXECUTED" },
    });
    expect(journalCount).toBe(1);

    // An immutable reconciliation incident was raised, linked to the SECOND attempt AND its own journal.
    const incident = await prisma.refundReconciliationIncident.findUniqueOrThrow({ where: { refundAttemptId: secondAttemptId } });
    expect(incident.refundObligationId).toBe(fixture.refundObligationId);
    expect(incident.reasonCode).toBe("DUPLICATE_PROVIDER_REFUND");
    expect(incident.status).toBe("OPEN");
    expect(Number(incident.excessAmount)).toBe(fixture.amount);

    // The reconciliation journal itself: DEBIT REFUND_RECONCILIATION_RECEIVABLE / CREDIT CASH_CLEARING, balanced.
    const reconciliationJournal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: incident.journalEntryId } });
    expect(reconciliationJournal.eventType).toBe("REFUND_RECONCILIATION");
    const reconciliationPostings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: reconciliationJournal.id } });
    const debit = reconciliationPostings.find((p) => p.direction === "DEBIT")!;
    const credit = reconciliationPostings.find((p) => p.direction === "CREDIT")!;
    expect(debit.account).toBe("REFUND_RECONCILIATION_RECEIVABLE");
    expect(credit.account).toBe("CASH_CLEARING");
    expect(Number(debit.amount)).toBe(fixture.amount);
    expect(Number(credit.amount)).toBe(fixture.amount);
    // Never touches SUPPLIER_PAYABLE or SHIPPING_LIABILITY.
    const reconciliationAccounts = reconciliationPostings.map((p) => p.account);
    expect(reconciliationAccounts).not.toContain("SUPPLIER_PAYABLE");
    expect(reconciliationAccounts).not.toContain("SHIPPING_LIABILITY");

    const incidentAudits = await prisma.auditLog.count({
      where: { entityId: fixture.refundObligationId, action: "REFUND_DUPLICATE_SUCCESS_CRITICAL_INCIDENT" },
    });
    expect(incidentAudits).toBe(1);

    const events = await prisma.refundProviderEvent.findFirstOrThrow({ where: { providerEventId: `evt-dupsuccess-${secondAttemptId}` } });
    expect(events.processingOutcome).toBe("DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION");
  }, 30_000);

  it("a duplicate webhook replay for the SAME already-reconciled attempt does not create a second incident", async () => {
    const __ref_1 = `prov-ref-first-replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const __ref_2 = `prov-ref-second-replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDDUPINCIDENTREPLAY");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const secondAttemptId = crypto.randomUUID();
    await prisma.refundAttempt.create({
      data: {
        id: secondAttemptId,
        refundObligationId: fixture.refundObligationId,
        providerCode: "MOCK_REFUND",
        idempotencyKey: `REFUND_ATTEMPT:${secondAttemptId}`,
        status: "PENDING",
        providerReference: __ref_2,
      },
    });

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: secondAttemptId,
      providerReference: __ref_2,
      providerEventId: `evt-replay-${secondAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    const first = await webhook.handleWebhook("MOCK_REFUND", rawBody, headers);
    const second = await webhook.handleWebhook("MOCK_REFUND", rawBody, headers);
    expect(second).toEqual(first);

    const incidentCount = await prisma.refundReconciliationIncident.count({ where: { refundAttemptId: secondAttemptId } });
    expect(incidentCount).toBe(1);
  }, 30_000);

  it("a THIRD, independently distinct successful attempt raises its OWN separate incident, linked to itself", async () => {
    const __ref_1 = `prov-ref-original-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const __ref_2 = `prov-ref-second-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const __ref_3 = `prov-ref-third-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDTHIRDINCIDENT");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const secondAttemptId = crypto.randomUUID();
    await prisma.refundAttempt.create({
      data: { id: secondAttemptId, refundObligationId: fixture.refundObligationId, providerCode: "MOCK_REFUND", idempotencyKey: `REFUND_ATTEMPT:${secondAttemptId}`, status: "PENDING", providerReference: __ref_2 },
    });
    const secondWh = provider.buildSignedWebhook({
      merchantReference: secondAttemptId,
      providerReference: __ref_2,
      providerEventId: `evt-third-second-${secondAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    await webhook.handleWebhook("MOCK_REFUND", secondWh.rawBody, secondWh.headers);

    const thirdAttemptId = crypto.randomUUID();
    await prisma.refundAttempt.create({
      data: { id: thirdAttemptId, refundObligationId: fixture.refundObligationId, providerCode: "MOCK_REFUND", idempotencyKey: `REFUND_ATTEMPT:${thirdAttemptId}`, status: "PENDING", providerReference: __ref_3 },
    });
    const thirdWh = provider.buildSignedWebhook({
      merchantReference: thirdAttemptId,
      providerReference: __ref_3,
      providerEventId: `evt-third-third-${thirdAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    const thirdResult = await webhook.handleWebhook("MOCK_REFUND", thirdWh.rawBody, thirdWh.headers);
    expect(thirdResult.processingOutcome).toBe("DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION");

    const thirdAttempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: thirdAttemptId } });
    expect(thirdAttempt.status).toBe("SUCCEEDED");

    const incidents = await prisma.refundReconciliationIncident.findMany({ where: { refundObligationId: fixture.refundObligationId } });
    expect(incidents).toHaveLength(2);
    expect(incidents.map((i) => i.refundAttemptId).sort()).toEqual([secondAttemptId, thirdAttemptId].sort());

    const journalCount = await prisma.journalEntry.count({
      where: { referenceType: "refund_obligation", referenceId: fixture.refundObligationId, eventType: "REFUND_EXECUTED" },
    });
    expect(journalCount).toBe(1);
  }, 30_000);

  it("Trigger COMPLETED accepts MORE THAN ONE SUCCEEDED attempt but still rejects zero", async () => {
    const __ref_1 = `prov-ref-multi-1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const __ref_2 = `prov-ref-multi-2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDMULTISUCCEEDEDOK");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const secondAttemptId = crypto.randomUUID();
    await prisma.refundAttempt.create({
      data: { id: secondAttemptId, refundObligationId: fixture.refundObligationId, providerCode: "MOCK_REFUND", idempotencyKey: `REFUND_ATTEMPT:${secondAttemptId}`, status: "PENDING", providerReference: __ref_2 },
    });
    const secondWh = provider.buildSignedWebhook({
      merchantReference: secondAttemptId,
      providerReference: __ref_2,
      providerEventId: `evt-multi-${secondAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    await webhook.handleWebhook("MOCK_REFUND", secondWh.rawBody, secondWh.headers);

    // Now TWO SUCCEEDED attempts exist for this obligation — the
    // "at least one" trigger must still be satisfied (it is, by construction).
    const succeededCount = await prisma.refundAttempt.count({ where: { refundObligationId: fixture.refundObligationId, status: "SUCCEEDED" } });
    expect(succeededCount).toBe(2);
    const obligation = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(obligation.status).toBe("COMPLETED");
  }, 30_000);

  it("DB: providerReference cannot be changed once set (idempotent re-send of the SAME value is fine; a DIFFERENT value is rejected)", async () => {
    const __ref_1 = `prov-ref-original-value-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDPROVREFFROZEN");
    const { execution, provider } = buildServices();
    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const sent = await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    await expect(
      prisma.$executeRaw`UPDATE refund_attempts SET provider_reference = 'prov-ref-DIFFERENT-value' WHERE id = ${sent.refundAttemptId}::uuid`
    ).rejects.toThrow(/provider_reference is frozen once set/);
  }, 30_000);

  it("DB: UNIQUE(providerCode, providerReference) rejects two attempts sharing the same provider reference", async () => {
    const fixtureA = await seedRefundFixture("REFUNDPROVREFUNIQUEA");
    const fixtureB = await seedRefundFixture("REFUNDPROVREFUNIQUEB");
    const sharedReference = `prov-ref-shared-value-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { execution: execA, provider: providerA } = buildServices();
    providerA.setNextExecuteRefundResult({ outcome: "SENT", providerReference: sharedReference });
    await execA.startAttempt(fixtureA.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const { execution: execB, provider: providerB } = buildServices();
    providerB.setNextExecuteRefundResult({ outcome: "SENT", providerReference: sharedReference });
    await expect(execB.startAttempt(fixtureB.refundObligationId, "MOCK_REFUND", { requestId: "r2" })).rejects.toThrow();
  }, 30_000);

  it("THREE successful attempts: exactly one normal REFUND_EXECUTED journal + two reconciliation journals, and SUM(CASH_CLEARING) reflects ALL cash that actually went out", async () => {
    const fixture = await seedRefundFixture("REFUNDTHREESUCCESS");
    const { execution, webhook, provider } = buildServices();

    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: `prov-ref-three-1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const secondAttemptId = crypto.randomUUID();
    await prisma.refundAttempt.create({
      data: { id: secondAttemptId, refundObligationId: fixture.refundObligationId, providerCode: "MOCK_REFUND", idempotencyKey: `REFUND_ATTEMPT:${secondAttemptId}`, status: "PENDING", providerReference: `prov-ref-three-2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    });
    const secondAttempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: secondAttemptId } });
    const secondWh = provider.buildSignedWebhook({
      merchantReference: secondAttemptId,
      providerReference: secondAttempt.providerReference!,
      providerEventId: `evt-three-2-${secondAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    await webhook.handleWebhook("MOCK_REFUND", secondWh.rawBody, secondWh.headers);

    const thirdAttemptId = crypto.randomUUID();
    await prisma.refundAttempt.create({
      data: { id: thirdAttemptId, refundObligationId: fixture.refundObligationId, providerCode: "MOCK_REFUND", idempotencyKey: `REFUND_ATTEMPT:${thirdAttemptId}`, status: "PENDING", providerReference: `prov-ref-three-3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    });
    const thirdAttempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: thirdAttemptId } });
    const thirdWh = provider.buildSignedWebhook({
      merchantReference: thirdAttemptId,
      providerReference: thirdAttempt.providerReference!,
      providerEventId: `evt-three-3-${thirdAttemptId}`,
      eventType: "SUCCESS",
      amount: fixture.amount,
    });
    await webhook.handleWebhook("MOCK_REFUND", thirdWh.rawBody, thirdWh.headers);

    const normalJournalCount = await prisma.journalEntry.count({
      where: { referenceType: "refund_obligation", referenceId: fixture.refundObligationId, eventType: "REFUND_EXECUTED" },
    });
    expect(normalJournalCount).toBe(1);

    const reconciliationJournals = await prisma.journalEntry.findMany({ where: { eventType: "REFUND_RECONCILIATION", referenceId: { in: [secondAttemptId, thirdAttemptId] } } });
    expect(reconciliationJournals).toHaveLength(2);

    // SUM(CASH_CLEARING credits) across ALL journals for this obligation reflects the full THREE transfers.
    const allJournalIds = [
      ...(await prisma.journalEntry.findMany({ where: { referenceType: "refund_obligation", referenceId: fixture.refundObligationId, eventType: "REFUND_EXECUTED" } })).map((j) => j.id),
      ...reconciliationJournals.map((j) => j.id),
    ];
    const cashClearingPostings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: { in: allJournalIds }, account: "CASH_CLEARING" } });
    const totalCashOut = cashClearingPostings.reduce((sum, p) => sum + Number(p.amount), 0);
    expect(Math.round(totalCashOut * 100)).toBe(Math.round(fixture.amount * 3 * 100));
  }, 30_000);

  it("DB: a RefundReconciliationIncident cannot exist without a valid journal_entry_id (NOT NULL + FK enforced directly)", async () => {
    const fixture = await seedRefundFixture("REFUNDINCIDENTNOJOURNAL");
    const { execution, provider } = buildServices();
    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: `prov-ref-incnojournal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const secondAttemptId = crypto.randomUUID();
    await prisma.refundAttempt.create({
      data: { id: secondAttemptId, refundObligationId: fixture.refundObligationId, providerCode: "MOCK_REFUND", idempotencyKey: `REFUND_ATTEMPT:${secondAttemptId}`, status: "PENDING", providerReference: `prov-ref-incnojournal2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    });

    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE refund_attempts SET status = 'SUCCEEDED' WHERE id = ${secondAttemptId}::uuid`;
          await tx.$executeRaw`INSERT INTO refund_reconciliation_incidents (refund_obligation_id, refund_attempt_id, excess_amount, currency, reason_code) VALUES (${fixture.refundObligationId}::uuid, ${secondAttemptId}::uuid, ${fixture.amount}, 'SAR', 'DUPLICATE_PROVIDER_REFUND')`;
        });
      })()
    ).rejects.toThrow();
  }, 30_000);

  it("DB: an unbalanced reconciliation journal (DEBIT != CREDIT) is rejected at SET CONSTRAINTS IMMEDIATE", async () => {
    const fixture = await seedRefundFixture("REFUNDUNBALANCEDRECON");
    const { execution, provider } = buildServices();
    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: `prov-ref-unbalanced-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    await execution.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const secondAttemptId = crypto.randomUUID();
    await prisma.refundAttempt.create({
      data: { id: secondAttemptId, refundObligationId: fixture.refundObligationId, providerCode: "MOCK_REFUND", idempotencyKey: `REFUND_ATTEMPT:${secondAttemptId}`, status: "PENDING", providerReference: `prov-ref-unbalanced2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    });

    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE refund_attempts SET status = 'SUCCEEDED' WHERE id = ${secondAttemptId}::uuid`;
          const journal = await tx.journalEntry.create({
            data: { eventType: "REFUND_RECONCILIATION", referenceType: "refund_attempt", referenceId: secondAttemptId, idempotencyKey: `test-unbalanced-${Date.now()}` },
          });
          await tx.ledgerPosting.createMany({
            data: [
              { journalEntryId: journal.id, account: "REFUND_RECONCILIATION_RECEIVABLE", direction: "DEBIT", amount: fixture.amount },
              { journalEntryId: journal.id, account: "CASH_CLEARING", direction: "CREDIT", amount: fixture.amount - 1 },
            ],
          });
          await tx.$executeRaw`INSERT INTO refund_reconciliation_incidents (refund_obligation_id, refund_attempt_id, journal_entry_id, excess_amount, currency, reason_code) VALUES (${fixture.refundObligationId}::uuid, ${secondAttemptId}::uuid, ${journal.id}::uuid, ${fixture.amount}, 'SAR', 'DUPLICATE_PROVIDER_REFUND')`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/unbalanced/);
  }, 15_000);
});
