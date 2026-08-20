import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { RefundExecutionService } from "../src/refunds/refund-execution.service";
import { RefundProviderRegistry } from "../src/refunds/providers/refund-provider.registry";
import { MockRefundProvider } from "../src/refunds/providers/mock-refund.provider";
import { seedRefundFixture, refundFixturePrisma } from "./fixtures/refund.fixture";

const prisma = refundFixturePrisma;

function buildService() {
  const registry = new RefundProviderRegistry();
  const provider = new MockRefundProvider();
  registry.register(provider);
  return { service: new RefundExecutionService(prisma as unknown as PrismaService, registry), provider };
}

describe("RefundExecutionService — core TX1/external-call/TX2 lifecycle (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("happy path: a synchronous SUCCEEDED completes the obligation with a balanced ledger entry", async () => {
    const __ref_1 = `prov-ref-happy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDHAPPY");
    const { service, provider } = buildService();

    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    const result = await service.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    expect(result.outcome).toBe("SUCCEEDED");

    const obligation = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(obligation.status).toBe("COMPLETED");

    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "refund_obligation", referenceId: fixture.refundObligationId } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: journal.id } });
    const debitSum = postings.filter((p) => p.direction === "DEBIT").reduce((s, p) => s + Number(p.amount), 0);
    const creditSum = postings.filter((p) => p.direction === "CREDIT").reduce((s, p) => s + Number(p.amount), 0);
    expect(Math.round(debitSum * 100)).toBe(Math.round(creditSum * 100));
    expect(Math.round(creditSum * 100)).toBe(Math.round(fixture.amount * 100));
  }, 30_000);

  it("crash BEFORE the provider call (TX1 succeeded, external call never happened): retrying reuses the same attempt/idempotencyKey", async () => {
    const __ref_1 = `prov-ref-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDCRASHBEFORE");
    const { service, provider } = buildService();

    provider.setNextExecuteRefundThrows(new Error("simulated crash before provider responded"));
    await expect(service.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" })).rejects.toThrow();

    const attemptsAfterCrash = await prisma.refundAttempt.findMany({ where: { refundObligationId: fixture.refundObligationId } });
    expect(attemptsAfterCrash).toHaveLength(1);
    expect(attemptsAfterCrash[0].status).toBe("CREATED");
    const firstAttemptId = attemptsAfterCrash[0].id;
    const firstIdempotencyKey = attemptsAfterCrash[0].idempotencyKey;

    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const retryResult = await service.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r2" });
    expect(retryResult.refundAttemptId).toBe(firstAttemptId);

    const attemptsAfterRetry = await prisma.refundAttempt.findMany({ where: { refundObligationId: fixture.refundObligationId } });
    expect(attemptsAfterRetry).toHaveLength(1);
    expect(attemptsAfterRetry[0].idempotencyKey).toBe(firstIdempotencyKey);
    expect(attemptsAfterRetry[0].status).toBe("PENDING");
  }, 30_000);

  it("RETRYABLE_UNKNOWN leaves the attempt CREATED and reuses the same id/key on retry — no new attempt is ever created", async () => {
    const fixture = await seedRefundFixture("REFUNDRETRYUNKNOWN");
    const { service, provider } = buildService();

    provider.setNextExecuteRefundResult({ outcome: "RETRYABLE_UNKNOWN", reason: "network timeout, outcome unknown" });
    const first = await service.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    expect(first.outcome).toBe("RETRYABLE_UNKNOWN");

    const attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: first.refundAttemptId } });
    expect(attempt.status).toBe("CREATED");
    const key = attempt.idempotencyKey;

    provider.setNextExecuteRefundResult({ outcome: "RETRYABLE_UNKNOWN", reason: "still unknown" });
    const second = await service.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r2" });
    expect(second.refundAttemptId).toBe(first.refundAttemptId);

    const attemptsTotal = await prisma.refundAttempt.count({ where: { refundObligationId: fixture.refundObligationId } });
    expect(attemptsTotal).toBe(1);
    const finalAttempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: first.refundAttemptId } });
    expect(finalAttempt.idempotencyKey).toBe(key);
    expect(finalAttempt.status).toBe("CREATED");
  }, 30_000);

  it("DEFINITIVE_FAILED allows a brand new attempt afterward — the old one stays terminal, a new one is created", async () => {
    const __ref_1 = `prov-ref-second-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDDEFFAILEDNEW");
    const { service, provider } = buildService();

    provider.setNextExecuteRefundResult({ outcome: "DEFINITIVE_FAILURE", reason: "insufficient funds" });
    const first = await service.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });
    expect(first.outcome).toBe("DEFINITIVE_FAILED");

    const obligationAfterFail = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(obligationAfterFail.status).toBe("FAILED");

    provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: __ref_1 });
    const second = await service.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r2" });
    expect(second.refundAttemptId).not.toBe(first.refundAttemptId);

    const attemptsTotal = await prisma.refundAttempt.count({ where: { refundObligationId: fixture.refundObligationId } });
    expect(attemptsTotal).toBe(2);
    const obligationAfterSecond = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(obligationAfterSecond.status).toBe("SENT");
  }, 30_000);

  it("PAYMENT_EXCEPTION-source obligations (7C's original refunds) execute identically, but never touch SUPPLIER_PAYABLE", async () => {
    const __ref_1 = `prov-ref-payment-exc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDPAYMENTEXC");
    const paymentException = await prisma.refundObligation.create({
      data: {
        paymentAttemptId: fixture.paymentAttemptId,
        source: "PAYMENT_EXCEPTION",
        reasonCode: "CAPTURE_AMOUNT_MISMATCH",
        amount: 1,
        currency: "SAR",
      },
    });

    const { service, provider } = buildService();
    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    const result = await service.startAttempt(paymentException.id, "MOCK_REFUND", { requestId: "r1" });
    expect(result.outcome).toBe("SUCCEEDED");

    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "refund_obligation", referenceId: paymentException.id } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: journal.id } });
    const accounts = postings.map((p) => p.account).sort();
    expect(accounts).not.toContain("SUPPLIER_PAYABLE");
    expect(accounts).toEqual(["CASH_CLEARING", "CUSTOMER_REFUND_PAYABLE"].sort());
  }, 30_000);

  it("no refund execution path ever changes fundedQuantity, Opportunity.status, or MasterOrder.supplierPayableAmount", async () => {
    const __ref_1 = `prov-ref-nosidefx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await seedRefundFixture("REFUNDNOSIDEFX");
    const paymentAttempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: fixture.paymentAttemptId }, include: { order: true } });
    const masterOrder = paymentAttempt.order!;
    const opportunityBefore = await prisma.opportunity.findUniqueOrThrow({ where: { id: masterOrder.opportunityId } });

    const { service, provider } = buildService();
    provider.setNextExecuteRefundResult({ outcome: "SUCCEEDED", providerReference: __ref_1 });
    await service.startAttempt(fixture.refundObligationId, "MOCK_REFUND", { requestId: "r1" });

    const opportunityAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: masterOrder.opportunityId } });
    expect(opportunityAfter.fundedQuantity).toBe(opportunityBefore.fundedQuantity);
    expect(opportunityAfter.status).toBe(opportunityBefore.status);

    const masterOrderAfter = await prisma.masterOrder.findUniqueOrThrow({ where: { id: masterOrder.id } });
    expect(masterOrderAfter.status).toBe(masterOrder.status);
    expect(masterOrderAfter.supplierPayableAmount.toString()).toBe(masterOrder.supplierPayableAmount.toString());
  }, 30_000);
});
