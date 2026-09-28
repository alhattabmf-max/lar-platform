import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { PaymentWebhookService } from "../src/payments/payment-webhook.service";
import { CommissionTaxPolicyService } from "../src/settings/commission-tax-policy.service";
import { AuditService } from "../src/audit/audit.service";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { BusinessException } from "../src/common/errors/business-exception";
import { AdminOpportunitiesService } from "../src/admin/opportunities/admin-opportunities.service";
import { seedPaymentFixture, paymentFixturePrisma, buildPaymentAttemptService } from "./fixtures/payment.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = paymentFixturePrisma;
const provider = new MockPaymentProvider();

function halalas(amount: number): number {
  return Math.round(amount * 100);
}

function sumHalalas(postings: { amount: unknown }[]): number {
  return postings.reduce((s, p) => s + halalas(Number(p.amount)), 0);
}

function buildWebhookService(p: PrismaService) {
  const audit = new AuditService(p);
  return new PaymentWebhookService(p, new CommissionTaxPolicyService(p, audit), provider, notificationEvents());
}

describe("PaymentWebhookService — critical scenarios (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("Capture AFTER opportunity cancellation (providerCapturedAt >= lockReleasedAt) -> RefundObligation, no Order, fundedQuantity untouched", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "LATECANCEL" });
    const beforeFunded = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).fundedQuantity;

    const adminOpportunities = new AdminOpportunitiesService(prisma as unknown as PrismaService, {} as never);
    await adminOpportunities.cancel(fixture.opportunityId, "test cancel", { actorId: crypto.randomUUID(), requestId: "req-cancel" });

    const session = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: fixture.checkoutSessionId } });
    expect(session.status).toBe("ABANDONED");
    const lockReleasedAt = session.lockReleasedAt!;

    const service = buildWebhookService(prisma as unknown as PrismaService);
    const capturedAt = new Date(lockReleasedAt.getTime() + 1000);
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: capturedAt,
      providerCapturedAmount: fixture.providerAmount,
    });

    const result = await service.handleWebhook(rawBody, headers);
    expect(result.processingOutcome).toBe("REFUND_REQUIRED");

    const refund = await prisma.refundObligation.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    expect(refund.reasonCode).toBe("LATE_CAPTURE_AFTER_CANCEL");
    expect(Number(refund.amount)).toBe(fixture.providerAmount);

    const orders = await prisma.masterOrder.findMany({ where: { checkoutSessionId: fixture.checkoutSessionId } });
    expect(orders).toHaveLength(0);

    const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opp.fundedQuantity).toBe(beforeFunded);
    expect(opp.status).toBe("CANCELLED");

    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceId: refund.id } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: journal.id } });
    const debitHalalas = sumHalalas(postings.filter((p) => p.direction === "DEBIT"));
    const creditHalalas = sumHalalas(postings.filter((p) => p.direction === "CREDIT"));
    expect(debitHalalas).toBe(creditHalalas);
    const refundPosting = postings.find((p) => p.account === "CUSTOMER_REFUND_PAYABLE");
    expect(Number(refundPosting!.amount)).toBe(fixture.providerAmount);
  }, 30_000);

  it("Capture BEFORE opportunity cancellation, webhook arrives AFTER -> Order IS created (providerCapturedAt decides, not arrival order)", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "EARLYCANCEL" });
    const capturedAt = new Date();

    const adminOpportunities = new AdminOpportunitiesService(prisma as unknown as PrismaService, {} as never);
    await adminOpportunities.cancel(fixture.opportunityId, "test cancel", { actorId: crypto.randomUUID(), requestId: "req-cancel" });

    const service = buildWebhookService(prisma as unknown as PrismaService);
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: capturedAt,
      providerCapturedAmount: fixture.providerAmount,
    });

    const result = await service.handleWebhook(rawBody, headers);
    expect(result.processingOutcome).toBe("ORDER_CREATED");

    const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opp.fundedQuantity).toBe(4);
    expect(opp.status).toBe("CANCELLED");
  }, 30_000);

  it("Amount mismatch: captured amount != PaymentAttempt amount -> REFUND_REQUIRED, CAPTURE_AMOUNT_MISMATCH, refund amount = actually captured amount", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "MISMATCH" });
    const service = buildWebhookService(prisma as unknown as PrismaService);
    const wrongAmount = fixture.providerAmount + 17.5;
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: wrongAmount,
    });

    const result = await service.handleWebhook(rawBody, headers);
    expect(result.processingOutcome).toBe("REFUND_REQUIRED");

    const refund = await prisma.refundObligation.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    expect(refund.reasonCode).toBe("CAPTURE_AMOUNT_MISMATCH");
    expect(Number(refund.amount)).toBe(wrongAmount);

    const orders = await prisma.masterOrder.findMany({ where: { checkoutSessionId: fixture.checkoutSessionId } });
    expect(orders).toHaveLength(0);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: fixture.paymentAttemptId } });
    expect(Number(attempt.providerCapturedAmount)).toBe(wrongAmount);
  }, 30_000);

  it("same providerEventId with a DIFFERENT payload hash is rejected as a security incident, never silently replayed", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "HASHMISMATCH" });
    const service = buildWebhookService(prisma as unknown as PrismaService);
    const eventId = `evt-${fixture.merchantReference}`;

    const first = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-a`,
      providerEventId: eventId,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });
    await service.handleWebhook(first.rawBody, first.headers);

    const second = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-b`,
      providerEventId: eventId,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });

    await expect(service.handleWebhook(second.rawBody, second.headers)).rejects.toThrow();

    const events = await prisma.providerPaymentEvent.count({ where: { providerEventId: eventId } });
    expect(events).toBe(1);
  }, 30_000);

  it("a genuinely duplicate webhook (identical payload) returns the SAME stored outcome, no new event row", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "TRUEDUP" });
    const service = buildWebhookService(prisma as unknown as PrismaService);
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });

    const r1 = await service.handleWebhook(rawBody, headers);
    const r2 = await service.handleWebhook(rawBody, headers);
    expect(r1).toEqual(r2);

    const events = await prisma.providerPaymentEvent.count({ where: { providerEventId: `evt-${fixture.merchantReference}` } });
    expect(events).toBe(1);
    const orders = await prisma.masterOrder.count({ where: { checkoutSessionId: fixture.checkoutSessionId } });
    expect(orders).toBe(1);
  }, 30_000);

  it("a genuine LATE success for a FAILED/expired first attempt, after a second attempt already won and created the Order, is treated as real money captured -> REFUND_REQUIRED (DUPLICATE_SUCCESSFUL_CAPTURE), never ignored", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "LATESUCC" });
    const service = buildWebhookService(prisma as unknown as PrismaService);

    // The first attempt now fails DEFINITIVELY at the provider (from
    // the caller's point of view) — Checkout returns to LOCKED, first
    // attempt becomes FAILED. This is the only way, given the partial
    // unique index, that a second attempt can legitimately start on
    // the same checkout.
    const attemptService = buildPaymentAttemptService(prisma as unknown as PrismaService, provider);
    const firstAttemptBefore = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: fixture.paymentAttemptId } });
    expect(firstAttemptBefore.status).toBe("PENDING");

    // Force it to FAILED directly (simulating a definitive failure
    // webhook, without re-deriving the whole webhook machinery here).
    const failureWebhook = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-fail`,
      providerEventId: `evt-fail-${fixture.merchantReference}`,
      eventType: "FAILURE",
    });
    const failResult = await service.handleWebhook(failureWebhook.rawBody, failureWebhook.headers);
    expect(failResult.processingOutcome).toBe("PAYMENT_FAILED");

    const sessionAfterFail = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: fixture.checkoutSessionId } });
    expect(sessionAfterFail.status).toBe("LOCKED");

    // Second, genuinely separate attempt on the same checkout — succeeds.
    const second = (await attemptService.startPayment(fixture.checkoutSessionId, `second-${Date.now()}`, {
      userId: fixture.traderUserId,
      companyId: fixture.traderCompanyId,
      requestId: "req-second",
    })) as { id: string };

    const w1 = provider.buildSignedWebhook({
      merchantReference: second.id,
      providerReference: `ref-second`,
      providerEventId: `evt-second-${second.id}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });
    const r1 = await service.handleWebhook(w1.rawBody, w1.headers);
    expect(r1.processingOutcome).toBe("ORDER_CREATED");

    // Now a LATE, genuine success arrives for the FIRST (already
    // FAILED) attempt — the money was actually captured there too.
    const w2 = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-first-late`,
      providerEventId: `evt-first-late-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });
    const r2 = await service.handleWebhook(w2.rawBody, w2.headers);
    expect(r2.processingOutcome).toBe("REFUND_REQUIRED");

    const refund = await prisma.refundObligation.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    expect(refund.reasonCode).toBe("DUPLICATE_SUCCESSFUL_CAPTURE");
    expect(Number(refund.amount)).toBe(fixture.providerAmount);

    const firstAttemptAfter = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: fixture.paymentAttemptId } });
    expect(firstAttemptAfter.status).toBe("SUCCEEDED"); // money captured is recorded as truth, not left as FAILED

    const orders = await prisma.masterOrder.count({ where: { checkoutSessionId: fixture.checkoutSessionId } });
    expect(orders).toBe(1);
  }, 30_000);

  it("a SUCCESS without providerCapturedAt is refused as malformed, deliberately, and writes nothing", async () => {
    // THE MOMENT OF CAPTURE IS NOT OPTIONAL ON A SUCCESS.
    //
    // It is what the two tests at the top of this file turn on: a
    // capture that happened after the offer was cancelled must be
    // refunded, one that happened before must become an order. A
    // SUCCESS with no moment cannot be placed on either side of that
    // line.
    //
    // Before this was checked, such an event was written straight into
    // `payment_attempts` and stopped only by
    // `payment_attempts_captured_at_amount_consistency` — a raw
    // Postgres error inside the webhook's transaction, which every
    // provider answers by delivering the same event again for ever.
    const fixture = await seedPaymentFixture({ traderCrPrefix: "NOCAPTIME" });
    const service = buildWebhookService(prisma as unknown as PrismaService);
    const providerEventId = `evt-nocaptime-${fixture.merchantReference}`;
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId,
      eventType: "SUCCESS",
      providerCapturedAmount: fixture.providerAmount,
      // providerCapturedAt deliberately absent.
    });

    // A 400, naming the missing field — not a constraint violation.
    const error = await service.handleWebhook(rawBody, headers).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).getStatus()).toBe(400);
    expect((error as BusinessException).message).toContain("providerCapturedAt");

    // REFUSED BEFORE THE TRANSACTION OPENS, so there is no idempotency
    // claim to roll back and the attempt is untouched.
    const claim = await prisma.$queryRaw<{ key: string }[]>`
      SELECT key FROM idempotency_keys WHERE key = ${providerEventId}
    `;
    expect(claim).toHaveLength(0);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: fixture.paymentAttemptId } });
    expect(attempt.status).not.toBe("SUCCEEDED");
    expect(attempt.providerCapturedAt).toBeNull();
    expect(attempt.providerCapturedAmount).toBeNull();

    const orders = await prisma.masterOrder.count({ where: { checkoutSessionId: fixture.checkoutSessionId } });
    expect(orders).toBe(0);
  }, 30_000);
});
