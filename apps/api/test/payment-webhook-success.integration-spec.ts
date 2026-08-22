import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { PaymentWebhookService } from "../src/payments/payment-webhook.service";
import { CommissionTaxPolicyService } from "../src/settings/commission-tax-policy.service";
import { AuditService } from "../src/audit/audit.service";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { seedPaymentFixture, paymentFixturePrisma } from "./fixtures/payment.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = paymentFixturePrisma;
const provider = new MockPaymentProvider();

/** Exact halalas (integer) — never a JS float comparison, no tolerance. */
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

describe("PaymentWebhookService — full success cycle (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("a successful webhook creates a MasterOrder + OrderAllocations + a balanced Ledger entry, increases fundedQuantity", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "PAYOK" });
    const service = buildWebhookService(prisma as unknown as PrismaService);

    const capturedAt = new Date();
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
    expect(result.masterOrderId).toBeDefined();

    const order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: result.masterOrderId } });
    expect(order.status).toBe("IN_FULFILLMENT");
    expect(Number(order.totalAmount)).toBe(fixture.providerAmount);
    expect(order.supplierBankAccountId).toBeDefined();

    const allocations = await prisma.orderAllocation.findMany({ where: { masterOrderId: order.id } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0].status).toBe("AWAITING_PREPARATION");
    expect(allocations[0].preparationDueAt.getTime()).toBeGreaterThan(capturedAt.getTime());

    const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opp.fundedQuantity).toBe(4);

    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceId: order.id } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: journal.id } });
    const debitHalalas = sumHalalas(postings.filter((p) => p.direction === "DEBIT"));
    const creditHalalas = sumHalalas(postings.filter((p) => p.direction === "CREDIT"));
    expect(debitHalalas).toBe(creditHalalas);
    expect(postings.length).toBeGreaterThanOrEqual(2);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: fixture.paymentAttemptId } });
    expect(attempt.status).toBe("SUCCEEDED");
    expect(Number(attempt.providerCapturedAmount)).toBe(fixture.providerAmount);

    const session = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: fixture.checkoutSessionId } });
    expect(session.status).toBe("PAID");
    expect(session.capturedAt).not.toBeNull();
    expect(session.releaseReason).toBeNull();
  }, 30_000);

  it("supplier payable equals grandTotal minus commission minus commissionTax exactly (no independent rounding drift)", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "PAYROUND" });
    const service = buildWebhookService(prisma as unknown as PrismaService);
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });
    const result = await service.handleWebhook(rawBody, headers);
    const order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: result.masterOrderId } });
    expect(halalas(Number(order.supplierPayableAmount))).toBe(
      halalas(Number(order.totalAmount)) - halalas(Number(order.commissionAmount)) - halalas(Number(order.commissionTaxAmount))
    );
  }, 30_000);

  it("a non-zero provider fee posts to PAYMENT_PROCESSING_FEE_EXPENSE and never reduces Supplier Payable", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "PAYFEE" });
    const service = buildWebhookService(prisma as unknown as PrismaService);
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
      providerFeeAmount: 2.5,
    });
    const result = await service.handleWebhook(rawBody, headers);
    const order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: result.masterOrderId } });
    const expectedPayableHalalas = halalas(Number(order.totalAmount)) - halalas(Number(order.commissionAmount)) - halalas(Number(order.commissionTaxAmount));
    expect(halalas(Number(order.supplierPayableAmount))).toBe(expectedPayableHalalas);

    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceId: order.id } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: journal.id } });
    const feePosting = postings.find((p) => p.account === "PAYMENT_PROCESSING_FEE_EXPENSE");
    expect(feePosting).toBeDefined();
    expect(Number(feePosting!.amount)).toBe(2.5);
    const debitHalalas = sumHalalas(postings.filter((p) => p.direction === "DEBIT"));
    const creditHalalas = sumHalalas(postings.filter((p) => p.direction === "CREDIT"));
    expect(debitHalalas).toBe(creditHalalas);
  }, 30_000);
});
