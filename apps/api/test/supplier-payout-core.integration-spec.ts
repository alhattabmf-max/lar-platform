import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { SupplierPayoutService } from "../src/settlement/supplier-payout.service";
import { RefundExecutionService } from "../src/refunds/refund-execution.service";
import { RefundWebhookService } from "../src/refunds/refund-webhook.service";
import { RefundProviderRegistry } from "../src/refunds/providers/refund-provider.registry";
import { MockRefundProvider } from "../src/refunds/providers/mock-refund.provider";
import {
  seedSettlementFixture,
  seedHistoricalDisputeRefundFixture,
  seedHistoricalFailedReplacementFixture,
  settlementFixturePrisma,
} from "./fixtures/settlement.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = settlementFixturePrisma;

function buildPayoutService(p: PrismaService = prisma as unknown as PrismaService) {
  return new SupplierPayoutService(p, notificationEvents());
}
function buildRefundServices(p: PrismaService = prisma as unknown as PrismaService) {
  const registry = new RefundProviderRegistry();
  const provider = new MockRefundProvider();
  registry.register(provider);
  const execution = new RefundExecutionService(p, registry, notificationEvents());
  const webhook = new RefundWebhookService(p, registry, execution, notificationEvents());
  return { execution, webhook, provider };
}
const adminCtx = () => ({ userId: crypto.randomUUID(), requestId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
const idemKey = (prefix: string) => `settle:${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

/** Completes a RefundObligation via the REAL public path: startAttempt (SENT) then a documented, signed webhook (SUCCESS). */
async function completeRefundViaRealPath(refundObligationId: string): Promise<void> {
  const { execution, webhook, provider } = buildRefundServices();
  const attemptRef = `prov-ref-${refundObligationId.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  provider.setNextExecuteRefundResult({ outcome: "SENT", providerReference: attemptRef });
  const started = await execution.startAttempt(refundObligationId, "MOCK_REFUND", { requestId: "r-complete-refund" });
  if (started.outcome !== "PENDING") throw new Error(`unexpected startAttempt outcome: ${started.outcome}`);

  const obligation = await prisma.refundObligation.findUniqueOrThrow({ where: { id: refundObligationId } });
  const { rawBody, headers } = provider.buildSignedWebhook({
    merchantReference: started.refundAttemptId,
    providerReference: attemptRef,
    providerEventId: `evt-complete-${started.refundAttemptId}`,
    eventType: "SUCCESS",
    amount: Number(obligation.amount),
  });
  const result = await webhook.handleWebhook("MOCK_REFUND", rawBody, headers);
  if (result.processingOutcome !== "SUCCEEDED") throw new Error(`unexpected webhook outcome: ${result.processingOutcome}`);
}

describe("SupplierPayoutService — core (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("standard settlement (no dispute): productNet + shippingFee, EXECUTED with a balanced ledger entry", async () => {
    const fixture = await seedSettlementFixture("PAYOUTSTANDARD");
    const service = buildPayoutService();
    const snapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });

    const result = await service.settle(
      fixture.deliveredOrderAllocationId,
      { externalTransferReference: `REF-STD-${Date.now()}` },
      adminCtx(),
      idemKey("std")
    );
    expect(result.outcome).toBe("EXECUTED");
    expect(result.netAmount).toBe(Number(snapshot.supplierPayableShareAmount) + Number(snapshot.shippingFeeAmount));

    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "supplier_payout", referenceId: result.supplierPayoutId } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: journal.id } });
    const debitSum = postings.filter((p) => p.direction === "DEBIT").reduce((s, p) => s + Number(p.amount), 0);
    const creditSum = postings.filter((p) => p.direction === "CREDIT").reduce((s, p) => s + Number(p.amount), 0);
    expect(Math.round(debitSum * 100)).toBe(Math.round(creditSum * 100));
    expect(Math.round(creditSum * 100)).toBe(Math.round(result.netAmount * 100));

    const allocation = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: fixture.deliveredOrderAllocationId } });
    expect(allocation.payoutSettledAt).not.toBeNull();
  }, 30_000);

  it("product-only refund: shippingNet stays full, productNet reduced by the executed DEBIT SUPPLIER_PAYABLE", async () => {
    const snapshotProbe = await seedSettlementFixture("PAYOUTPRODUCTONLYPROBE");
    const probeSnapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: snapshotProbe.deliveredOrderAllocationId } });
    const partialProduct = Math.floor((Number(probeSnapshot.productAmountInclTax) / 4) * 100) / 100;

    const fixture = await seedHistoricalDisputeRefundFixture("PAYOUTPRODUCTONLY", {
      decisionType: "PARTIAL_REFUND",
      productRefundAmountInclTax: partialProduct,
      shippingRefundAmount: 0,
    });
    await completeRefundViaRealPath(fixture.refundObligationId);

    const refund = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    expect(refund.status).toBe("COMPLETED");
    const executedJournal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "refund_obligation", referenceId: refund.id, eventType: "REFUND_EXECUTED" } });
    expect(executedJournal).not.toBeNull();

    const snapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    const disputeRefundJournal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "refund_obligation", referenceId: refund.id, eventType: "DISPUTE_REFUND_OBLIGATION" } });
    const disputeRefundPostings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: disputeRefundJournal.id, account: "SUPPLIER_PAYABLE", direction: "DEBIT" } });
    const executedSupplierPayableDebit = disputeRefundPostings.reduce((s, p) => s + Number(p.amount), 0);

    const service = buildPayoutService();
    const result = await service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: `REF-PRODONLY-${Date.now()}` }, adminCtx(), idemKey("prodonly"));
    expect(result.outcome).toBe("EXECUTED");

    const expectedProductNet = Math.round((Number(snapshot.supplierPayableShareAmount) - executedSupplierPayableDebit) * 100) / 100;
    const expectedNet = Math.round((expectedProductNet + Number(snapshot.shippingFeeAmount)) * 100) / 100;
    expect(result.netAmount).toBe(expectedNet);

    const settlementJournal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "supplier_payout", referenceId: result.supplierPayoutId } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: settlementJournal.id } });
    const shippingPosting = postings.find((p) => p.account === "SHIPPING_LIABILITY");
    expect(Number(shippingPosting!.amount)).toBe(Number(snapshot.shippingFeeAmount));
  }, 30_000);

  it("shipping-only refund: productNet stays full, shippingNet reduced by the executed DEBIT SHIPPING_LIABILITY", async () => {
    const fixture = await seedHistoricalDisputeRefundFixture("PAYOUTSHIPONLY", {
      decisionType: "PARTIAL_REFUND",
      productRefundAmountInclTax: 0,
      shippingRefundAmount: 5,
    });
    await completeRefundViaRealPath(fixture.refundObligationId);

    const snapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    const service = buildPayoutService();
    const result = await service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: `REF-SHIPONLY-${Date.now()}` }, adminCtx(), idemKey("shiponly"));
    expect(result.outcome).toBe("EXECUTED");

    const settlementJournal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "supplier_payout", referenceId: result.supplierPayoutId } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: settlementJournal.id } });
    const supplierPosting = postings.find((p) => p.account === "SUPPLIER_PAYABLE");
    expect(Number(supplierPosting!.amount)).toBe(Number(snapshot.supplierPayableShareAmount));
    const expectedShippingNet = Math.round((Number(snapshot.shippingFeeAmount) - 5) * 100) / 100;
    const shippingPosting = postings.find((p) => p.account === "SHIPPING_LIABILITY");
    expect(Number(shippingPosting!.amount)).toBe(expectedShippingNet);
  }, 30_000);

  it("full refund (product + shipping), executed via the real path: ZERO_BALANCE outcome, no ledger postings, no external transfer reference", async () => {
    const snapshotProbe = await seedSettlementFixture("PAYOUTFULLREFUNDPROBE");
    const probeSnapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: snapshotProbe.deliveredOrderAllocationId } });

    const fixture = await seedHistoricalDisputeRefundFixture("PAYOUTFULLREFUND", {
      decisionType: "FULL_REFUND",
      productRefundAmountInclTax: Number(probeSnapshot.productAmountInclTax),
      shippingRefundAmount: Number(probeSnapshot.shippingFeeAmount),
    });
    await completeRefundViaRealPath(fixture.refundObligationId);

    const service = buildPayoutService();
    const result = await service.settle(fixture.deliveredOrderAllocationId, {}, adminCtx(), idemKey("full"));
    expect(result.outcome).toBe("ZERO_BALANCE");
    expect(result.netAmount).toBe(0);
    expect(result.externalTransferReference).toBeNull();

    const journalCount = await prisma.journalEntry.count({ where: { referenceType: "supplier_payout", referenceId: result.supplierPayoutId } });
    expect(journalCount).toBe(0);
  }, 30_000);

  it("Company.payoutHoldUntil in the future BLOCKS settlement", async () => {
    const fixture = await seedSettlementFixture("PAYOUTHOLD");
    await prisma.company.update({ where: { id: fixture.supplierCompanyId }, data: { payoutHoldUntil: new Date(Date.now() + 86_400_000) } });

    const service = buildPayoutService();
    await expect(service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: "REF-HOLD" }, adminCtx(), idemKey("hold"))).rejects.toThrow();
  }, 30_000);

  it("changing the company's ACTIVE bank account after payment does NOT change the frozen account used for settlement", async () => {
    const fixture = await seedSettlementFixture("PAYOUTFROZENBANK");
    const masterOrderBefore = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });

    const newBankAccount = await prisma.supplierBankAccount.create({
      data: {
        companyId: fixture.supplierCompanyId,
        accountHolderName: "New Holder",
        bankName: "New Bank",
        ibanCiphertext: "cipher",
        ibanFingerprint: `fp-${Date.now()}`,
        ibanLast4: "9999",
        verificationStatus: "VERIFIED",
      },
    });

    const service = buildPayoutService();
    const result = await service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: `REF-FROZEN-${Date.now()}` }, adminCtx(), idemKey("frozen"));

    const payout = await prisma.supplierPayout.findUniqueOrThrow({ where: { id: result.supplierPayoutId } });
    expect(payout.supplierBankAccountId).toBe(masterOrderBefore.supplierBankAccountId);
    expect(payout.supplierBankAccountId).not.toBe(newBankAccount.id);
  }, 30_000);

  it("a duplicate external transfer reference is rejected", async () => {
    const fixtureA = await seedSettlementFixture("PAYOUTDUPREFA");
    const fixtureB = await seedSettlementFixture("PAYOUTDUPREFB");
    const service = buildPayoutService();
    const sharedRef = `REF-DUP-${Date.now()}`;

    await service.settle(fixtureA.deliveredOrderAllocationId, { externalTransferReference: sharedRef }, adminCtx(), idemKey("dupa"));
    await expect(service.settle(fixtureB.deliveredOrderAllocationId, { externalTransferReference: sharedRef }, adminCtx(), idemKey("dupb"))).rejects.toThrow();
  }, 30_000);

  it("a PENDING_EXECUTION DISPUTE refund obligation (execution not yet started) BLOCKS settlement", async () => {
    const fixture = await seedHistoricalDisputeRefundFixture("PAYOUTBLOCKEDREFUND", {
      decisionType: "FULL_REFUND",
      productRefundAmountInclTax: 1,
      shippingRefundAmount: 0,
    });
    // Deliberately never executed — RefundObligation stays PENDING_EXECUTION.

    const service = buildPayoutService();
    await expect(service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: "REF-BLOCKED" }, adminCtx(), idemKey("blocked"))).rejects.toThrow();
  }, 30_000);

  it("a FAILED replacement with no final refund decision yet BLOCKS settlement (dispute stays AWAITING_REPLACEMENT)", async () => {
    const fixture = await seedHistoricalFailedReplacementFixture("PAYOUTBLOCKEDREPL");

    const service = buildPayoutService();
    await expect(service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: "REF-REPLBLOCKED" }, adminCtx(), idemKey("replblocked"))).rejects.toThrow();
  }, 30_000);

  it("no settlement path ever changes fundedQuantity, Opportunity.status, or MasterOrder", async () => {
    const fixture = await seedSettlementFixture("PAYOUTNOSIDEFX");
    const opportunityBefore = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    const masterOrderBefore = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });

    const service = buildPayoutService();
    await service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: `REF-NOSIDEFX-${Date.now()}` }, adminCtx(), idemKey("nosidefx"));

    const opportunityAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opportunityAfter.fundedQuantity).toBe(opportunityBefore.fundedQuantity);
    expect(opportunityAfter.status).toBe(opportunityBefore.status);
    const masterOrderAfter = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    expect(masterOrderAfter.status).toBe(masterOrderBefore.status);
  }, 30_000);
});
