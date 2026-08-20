import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { computeSupplierPayoutNet } from "@platform/domain";
import { DisputeService } from "../src/disputes/dispute.service";
import { seedDisputeFixture, disputeFixturePrisma } from "./fixtures/dispute.fixture";

const prisma = disputeFixturePrisma;

async function simulateSettlement(orderAllocationId: string, masterOrderId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM order_allocations WHERE id = ${orderAllocationId}::uuid FOR UPDATE`;

    const snapshot = await tx.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId } });
    const completedRefunds = await tx.refundObligation.findMany({
      where: { source: "DISPUTE", disputeDecision: { dispute: { orderAllocationId } } },
    });
    const sumProductRelatedDebits = completedRefunds.reduce((sum, r) => {
      const productRefund = Number(r.productRefundAmountInclTax ?? 0);
      const commissionShareRatio = Number(snapshot.productAmountInclTax) > 0 ? productRefund / Number(snapshot.productAmountInclTax) : 0;
      const commissionReversal = Math.round(Number(snapshot.commissionShareAmount) * commissionShareRatio * 100) / 100;
      const commissionTaxReversal = Math.round(Number(snapshot.commissionShareTaxAmount) * commissionShareRatio * 100) / 100;
      return sum + (productRefund - commissionReversal - commissionTaxReversal);
    }, 0);
    const sumShippingRefundDebits = completedRefunds.reduce((sum, r) => sum + Number(r.shippingRefundAmount ?? 0), 0);

    const net = computeSupplierPayoutNet({
      snapshotSupplierPayableShareAmount: Number(snapshot.supplierPayableShareAmount),
      snapshotShippingFeeAmount: Number(snapshot.shippingFeeAmount),
      sumProductRelatedSupplierPayableDebits: sumProductRelatedDebits,
      sumShippingRefundDebits,
    });

    const masterOrder = await tx.masterOrder.findUniqueOrThrow({ where: { id: masterOrderId } });
    const outcome: "EXECUTED" | "ZERO_BALANCE" = net.netAmount > 0 ? "EXECUTED" : "ZERO_BALANCE";
    const externalTransferReference = outcome === "EXECUTED" ? `SETTLE-TEST-${orderAllocationId.slice(0, 8)}-${Date.now()}` : null;

    const payout = await tx.supplierPayout.create({
      data: {
        orderAllocationId,
        outcome,
        externalTransferReference,
        netAmount: net.netAmount,
        supplierBankAccountId: masterOrder.supplierBankAccountId,
        executedByAdminUserId: crypto.randomUUID(),
      },
    });

    if (net.netAmount > 0) {
      const journal = await tx.journalEntry.create({
        data: { eventType: "SUPPLIER_SETTLEMENT", referenceType: "supplier_payout", referenceId: payout.id, idempotencyKey: `settlement:${payout.id}` },
      });
      const postings: { journalEntryId: string; account: "SUPPLIER_PAYABLE" | "SHIPPING_LIABILITY" | "CASH_CLEARING"; direction: "DEBIT" | "CREDIT"; amount: number }[] = [];
      if (net.productNet > 0) postings.push({ journalEntryId: journal.id, account: "SUPPLIER_PAYABLE", direction: "DEBIT", amount: net.productNet });
      if (net.shippingNet > 0) postings.push({ journalEntryId: journal.id, account: "SHIPPING_LIABILITY", direction: "DEBIT", amount: net.shippingNet });
      postings.push({ journalEntryId: journal.id, account: "CASH_CLEARING", direction: "CREDIT", amount: net.netAmount });
      await tx.ledgerPosting.createMany({ data: postings });
      await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE`);
    }

    await tx.$executeRaw`UPDATE order_allocations SET payout_settled_at = now() WHERE id = ${orderAllocationId}::uuid AND payout_settled_at IS NULL`;
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_payout_settled_has_supplier_payout, trg_check_supplier_payout_has_payout_settled IMMEDIATE`);

    return { payout, net };
  });
}

describe("Supplier settlement — ledger balance to SupplierPayout.netAmount (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("no dispute at all: supplier gets productNet (=full share) + full shippingFee, ledger balances to netAmount", async () => {
    const fixture = await seedDisputeFixture("SETTLENOREFUND");
    const { payout, net } = await simulateSettlement(fixture.deliveredOrderAllocationId, fixture.masterOrderId);

    const snapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    expect(net.productNet).toBe(Number(snapshot.supplierPayableShareAmount));
    expect(net.shippingNet).toBe(Number(snapshot.shippingFeeAmount));
    expect(Number(payout.netAmount)).toBe(net.netAmount);

    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "supplier_payout", referenceId: payout.id } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: journal.id } });
    const debitSum = postings.filter((p) => p.direction === "DEBIT").reduce((s, p) => s + Number(p.amount), 0);
    const creditSum = postings.filter((p) => p.direction === "CREDIT").reduce((s, p) => s + Number(p.amount), 0);
    expect(Math.round(debitSum * 100)).toBe(Math.round(creditSum * 100));
    expect(Math.round(creditSum * 100)).toBe(Math.round(Number(payout.netAmount) * 100));
  }, 30_000);

  it("full product AND shipping refund makes the allocation's settlement net exactly zero, no ledger postings created", async () => {
    const fixture = await seedDisputeFixture("SETTLEFULLREFUND");
    const disputeService = new DisputeService(prisma as unknown as PrismaService);
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r3" };

    const dispute = await disputeService.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Full refund settlement test." }, traderCtx);
    await disputeService.supplierRespond(dispute.id, { responseType: "ACCEPT", description: "We accept full responsibility." }, supplierCtx);
    await disputeService.adminDecide(dispute.id, { decisionType: "FULL_REFUND", reasonNote: "Full refund." }, adminCtx, `idem-${dispute.id}-full`);

    const { payout, net } = await simulateSettlement(fixture.deliveredOrderAllocationId, fixture.masterOrderId);
    expect(net.productNet).toBe(0);
    expect(net.shippingNet).toBe(0);
    expect(net.netAmount).toBe(0);
    expect(Number(payout.netAmount)).toBe(0);

    const journal = await prisma.journalEntry.findFirst({ where: { referenceType: "supplier_payout", referenceId: payout.id } });
    expect(journal).toBeNull();
  }, 30_000);
});
