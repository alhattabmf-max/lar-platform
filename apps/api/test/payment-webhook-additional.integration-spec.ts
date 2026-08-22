import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { PaymentWebhookService } from "../src/payments/payment-webhook.service";
import { CommissionTaxPolicyService } from "../src/settings/commission-tax-policy.service";
import { AuditService } from "../src/audit/audit.service";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { seedPaymentFixture, paymentFixturePrisma } from "./fixtures/payment.fixture";
import { runPaymentPendingExpirySweep } from "@platform/opportunity-lifecycle";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = paymentFixturePrisma;
const provider = new MockPaymentProvider();

function halalas(amount: number): number {
  return Math.round(amount * 100);
}

function buildWebhookService(p: PrismaService) {
  const audit = new AuditService(p);
  return new PaymentWebhookService(p, new CommissionTaxPolicyService(p, audit), provider, notificationEvents());
}

describe("PaymentWebhookService — additional explicit scenarios (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("SUCCEEDED attempt, then a FAILURE webhook with a DIFFERENT eventId arrives later -> IGNORED_OUT_OF_ORDER, zero change to Order/fundedQuantity/Ledger/Checkout", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "FAILAFTERSUCC" });
    const service = buildWebhookService(prisma as unknown as PrismaService);

    const successWebhook = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-success-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });
    const successResult = await service.handleWebhook(successWebhook.rawBody, successWebhook.headers);
    expect(successResult.processingOutcome).toBe("ORDER_CREATED");
    const masterOrderId = successResult.masterOrderId!;

    const orderBefore = await prisma.masterOrder.findUniqueOrThrow({ where: { id: masterOrderId } });
    const oppBefore = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    const sessionBefore = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: fixture.checkoutSessionId } });
    const journalCountBefore = await prisma.journalEntry.count({ where: { referenceId: masterOrderId } });
    const ledgerCountBefore = await prisma.ledgerPosting.count({
      where: { journalEntry: { referenceId: masterOrderId } },
    });

    const failureWebhook = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-late-failure-${fixture.merchantReference}`,
      eventType: "FAILURE",
    });
    const failureResult = await service.handleWebhook(failureWebhook.rawBody, failureWebhook.headers);
    expect(failureResult.processingOutcome).toBe("IGNORED_OUT_OF_ORDER");

    const orderAfter = await prisma.masterOrder.findUniqueOrThrow({ where: { id: masterOrderId } });
    expect(orderAfter).toEqual(orderBefore);

    const oppAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(oppAfter.fundedQuantity).toBe(oppBefore.fundedQuantity);
    expect(oppAfter.status).toBe(oppBefore.status);

    const sessionAfter = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: fixture.checkoutSessionId } });
    expect(sessionAfter.status).toBe(sessionBefore.status);
    expect(sessionAfter.capturedAt?.getTime()).toBe(sessionBefore.capturedAt?.getTime());

    const journalCountAfter = await prisma.journalEntry.count({ where: { referenceId: masterOrderId } });
    expect(journalCountAfter).toBe(journalCountBefore);
    const ledgerCountAfter = await prisma.ledgerPosting.count({
      where: { journalEntry: { referenceId: masterOrderId } },
    });
    expect(ledgerCountAfter).toBe(ledgerCountBefore);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: fixture.paymentAttemptId } });
    expect(attempt.status).toBe("SUCCEEDED");

    const refunds = await prisma.refundObligation.count({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    expect(refunds).toBe(0);
  }, 30_000);

  it("providerCapturedAt is BEFORE paymentDeadlineAt, but the webhook arrives AFTER the real Worker sweep already expired the session -> session becomes PAID, Order IS created", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "EXPBEFORE" });

    const sessionRow = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: fixture.checkoutSessionId } });
    const originalDeadline = sessionRow.paymentDeadlineAt!;
    // Shift the deadline into the near past so the real sweep picks
    // it up immediately, while preserving the EXACT 5-second gap
    // between capture and deadline that this test is actually about.
    const shiftMs = Date.now() - 1_000 - originalDeadline.getTime();
    const newDeadline = new Date(originalDeadline.getTime() + shiftMs);
    const capturedAt = new Date(originalDeadline.getTime() - 5_000 + shiftMs); // still exactly 5s before the (shifted) deadline
    await prisma.checkoutSession.update({
      where: { id: fixture.checkoutSessionId },
      data: { paymentDeadlineAt: newDeadline },
    });

    const sweepResult = await runPaymentPendingExpirySweep(prisma as unknown as import("@prisma/client").PrismaClient);
    expect(sweepResult.attemptsExpired).toBeGreaterThanOrEqual(1);

    const expiredSession = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: fixture.checkoutSessionId } });
    expect(expiredSession.status).toBe("EXPIRED");
    const expiredAttempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: fixture.paymentAttemptId } });
    expect(expiredAttempt.status).toBe("EXPIRED");

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

    const finalSession = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: fixture.checkoutSessionId } });
    expect(finalSession.status).toBe("PAID");
    expect(finalSession.capturedAt?.getTime()).toBe(capturedAt.getTime());
    expect(finalSession.releaseReason).toBeNull();

    const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opp.fundedQuantity).toBe(4);
  }, 30_000);

  it("providerCapturedAt is AFTER paymentDeadlineAt -> REFUND_REQUIRED (LATE_CAPTURE_AFTER_DEADLINE), no Order, fundedQuantity unchanged", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "EXPAFTER" });

    const sessionRow = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: fixture.checkoutSessionId } });
    const originalDeadline = sessionRow.paymentDeadlineAt!;
    const shiftMs = Date.now() - 1_000 - originalDeadline.getTime();
    const newDeadline = new Date(originalDeadline.getTime() + shiftMs);
    const capturedAt = new Date(originalDeadline.getTime() + 5_000 + shiftMs); // still exactly 5s AFTER the (shifted) deadline
    await prisma.checkoutSession.update({
      where: { id: fixture.checkoutSessionId },
      data: { paymentDeadlineAt: newDeadline },
    });
    await runPaymentPendingExpirySweep(prisma as unknown as import("@prisma/client").PrismaClient);

    const beforeFunded = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).fundedQuantity;

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
    expect(result.processingOutcome).toBe("REFUND_REQUIRED");

    const refund = await prisma.refundObligation.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    expect(refund.reasonCode).toBe("LATE_CAPTURE_AFTER_DEADLINE");
    expect(halalas(Number(refund.amount))).toBe(halalas(fixture.providerAmount));

    const orders = await prisma.masterOrder.count({ where: { checkoutSessionId: fixture.checkoutSessionId } });
    expect(orders).toBe(0);

    const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opp.fundedQuantity).toBe(beforeFunded);
  }, 30_000);

  it("Currency mismatch (not amount) is independently rejected -> REFUND_REQUIRED, CAPTURE_AMOUNT_MISMATCH, no Order", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "CURRMISMATCH" });
    const service = buildWebhookService(prisma as unknown as PrismaService);

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      currency: "USD",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });

    const result = await service.handleWebhook(rawBody, headers);
    expect(result.processingOutcome).toBe("REFUND_REQUIRED");

    const refund = await prisma.refundObligation.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    expect(refund.reasonCode).toBe("CAPTURE_AMOUNT_MISMATCH");
    expect(halalas(Number(refund.amount))).toBe(halalas(fixture.providerAmount));

    const orders = await prisma.masterOrder.count({ where: { checkoutSessionId: fixture.checkoutSessionId } });
    expect(orders).toBe(0);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: fixture.paymentAttemptId } });
    expect(attempt.status).toBe("SUCCEEDED");
  }, 30_000);
});
