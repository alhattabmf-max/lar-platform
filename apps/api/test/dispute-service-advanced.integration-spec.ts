import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { DisputeService } from "../src/disputes/dispute.service";
import { seedDisputeFixture, disputeFixturePrisma } from "./fixtures/dispute.fixture";

const prisma = disputeFixturePrisma;

function buildService(p: PrismaService = prisma as unknown as PrismaService) {
  return new DisputeService(p);
}

describe("DisputeService — races, decision sequencing, ledger precision (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("race: opening a dispute vs settling the same allocation — never both succeed inconsistently", async () => {
    const fixture = await seedDisputeFixture("DISPRACESETTLE");
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };

    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();
    const serviceA = buildService(prismaA as unknown as PrismaService);

    const settleFn = async () => {
      await (prismaB as unknown as PrismaClient).$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM order_allocations WHERE id = ${fixture.deliveredOrderAllocationId}::uuid FOR UPDATE`;
        await new Promise((r) => setTimeout(r, 50));
        const existingDispute = await tx.dispute.findUnique({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
        if (existingDispute) return; // dispute won the race — settlement is not eligible, matches SupplierPayoutService's future eligibility check
        const updated = await tx.$executeRaw`
          UPDATE order_allocations SET payout_settled_at = now() WHERE id = ${fixture.deliveredOrderAllocationId}::uuid AND payout_settled_at IS NULL
        `;
        if (Number(updated) === 0) return;
        const order = await tx.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
        await tx.supplierPayout.create({
          data: {
            orderAllocationId: fixture.deliveredOrderAllocationId,
            outcome: "EXECUTED",
            externalTransferReference: `RACE-REF-${Date.now()}`,
            netAmount: 1,
            supplierBankAccountId: order.supplierBankAccountId,
            executedByAdminUserId: crypto.randomUUID(),
          },
        });
        await tx.$executeRawUnsafe(
          `SET CONSTRAINTS trg_check_payout_settled_has_supplier_payout, trg_check_supplier_payout_has_payout_settled IMMEDIATE`
        );
      });
    };

    const openFn = async () => {
      try {
        return await serviceA.openDispute(
          fixture.deliveredOrderAllocationId,
          { reasonCode: "ITEM_DAMAGED", description: "Racing against a settlement attempt." },
          traderCtx
        );
      } catch (e) {
        return { error: true, message: e instanceof Error ? e.message : String(e) };
      }
    };

    const [openResult] = await Promise.allSettled([openFn(), settleFn()]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    const finalAllocation = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: fixture.deliveredOrderAllocationId } });
    const finalDispute = await prisma.dispute.findUnique({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });

    if (finalAllocation.payoutSettledAt !== null) {
      expect(finalDispute).toBeNull();
    }
    if (finalDispute !== null) {
      expect(finalAllocation.payoutSettledAt).toBeNull();
    }
    expect(openResult.status).toBe("fulfilled");
  }, 30_000);

  it("race: adding evidence vs supplier responding — the Dispute row lock serializes the two", async () => {
    const fixture = await seedDisputeFixture("DISPRACEEVIDENCE");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };

    const dispute = await service.openDispute(
      fixture.deliveredOrderAllocationId,
      { reasonCode: "ITEM_DAMAGED", description: "Testing evidence vs response race." },
      traderCtx
    );

    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();
    const serviceA = buildService(prismaA as unknown as PrismaService);
    const serviceB = buildService(prismaB as unknown as PrismaService);

    const results = await Promise.allSettled([
      serviceA.addEvidence(dispute.id, `race-evidence-${Date.now()}.jpg`, traderCtx),
      serviceB.supplierRespond(dispute.id, { responseType: "ACCEPT", description: "Racing against evidence upload." }, supplierCtx),
    ]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    const finalDispute = await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id }, include: { supplierResponse: true } });
    expect(finalDispute.supplierResponse).not.toBeNull();
    const anySucceeded = results.some((r) => r.status === "fulfilled");
    expect(anySucceeded).toBe(true);
  }, 30_000);

  it("rejects a THIRD decision on any dispute — sequenceNumber IN (1,2) only", async () => {
    const fixture = await seedDisputeFixture("DISPTHIRDDECISION");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r3" };

    const dispute = await service.openDispute(
      fixture.deliveredOrderAllocationId,
      { reasonCode: "ITEM_DAMAGED", description: "Testing third decision rejection." },
      traderCtx
    );
    await service.supplierRespond(dispute.id, { responseType: "REPLACEMENT_OFFER", description: "We offer a replacement item." }, supplierCtx);

    await service.adminDecide(dispute.id, { decisionType: "REPLACEMENT", replacementQuantity: 1, reasonNote: "Replacement approved." }, adminCtx, `idem-${dispute.id}-d1`);

    const replacementObligation = await prisma.replacementObligation.findFirstOrThrow({
      where: { disputeDecision: { disputeId: dispute.id, sequenceNumber: 1 } },
    });
    await prisma.$executeRaw`UPDATE replacement_obligations SET status = 'FAILED', failed_at = now() WHERE id = ${replacementObligation.id}::uuid`;

    await service.adminDecide(dispute.id, { decisionType: "FULL_REFUND", reasonNote: "Replacement failed, issuing refund." }, adminCtx, `idem-${dispute.id}-d2`);

    await expect(
      service.adminDecide(dispute.id, { decisionType: "REJECTED", reasonNote: "Trying a third decision." }, adminCtx, `idem-${dispute.id}-d3`)
    ).rejects.toThrow();

    const decisions = await prisma.disputeDecision.findMany({ where: { disputeId: dispute.id } });
    expect(decisions).toHaveLength(2);
  }, 30_000);

  it("rejects a second decision when the first was NOT a replacement", async () => {
    const fixture = await seedDisputeFixture("DISPSECONDNOTREPL");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r3" };

    const dispute = await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Testing non-replacement first decision." }, traderCtx);
    await service.supplierRespond(dispute.id, { responseType: "REJECT", description: "We reject this claim." }, supplierCtx);
    await service.adminDecide(dispute.id, { decisionType: "REJECTED", reasonNote: "First decision: rejected." }, adminCtx, `idem-${dispute.id}-only`);

    await expect(
      service.adminDecide(dispute.id, { decisionType: "FULL_REFUND", reasonNote: "Trying a second decision anyway." }, adminCtx, `idem-${dispute.id}-second-bad`)
    ).rejects.toThrow();
  }, 30_000);

  it("Ledger for a partial refund is balanced to the cent — DEBIT sum equals CREDIT sum exactly", async () => {
    const fixture = await seedDisputeFixture("DISPLEDGERPRECISE");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r3" };

    const snapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    const partialProduct = Math.floor((Number(snapshot.productAmountInclTax) / 3) * 100) / 100;
    const partialShipping = Math.floor((Number(snapshot.shippingFeeAmount) / 3) * 100) / 100;

    const dispute = await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "QUANTITY_SHORTAGE", description: "Testing ledger precision on partial refund." }, traderCtx);
    await service.supplierRespond(dispute.id, { responseType: "PARTIAL_ACCEPT", description: "We accept partial responsibility." }, supplierCtx);
    const decision = await service.adminDecide(
      dispute.id,
      { decisionType: "PARTIAL_REFUND", productRefundAmountInclTax: partialProduct, shippingRefundAmount: partialShipping, reasonNote: "Partial refund granted." },
      adminCtx,
      `idem-${dispute.id}-partial`
    );

    const refund = await prisma.refundObligation.findUniqueOrThrow({ where: { disputeDecisionId: decision.decisionId } });
    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "refund_obligation", referenceId: refund.id } });
    const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: journal.id } });

    const debitSum = postings.filter((p) => p.direction === "DEBIT").reduce((sum, p) => sum + Number(p.amount), 0);
    const creditSum = postings.filter((p) => p.direction === "CREDIT").reduce((sum, p) => sum + Number(p.amount), 0);

    expect(Math.round(debitSum * 100)).toBe(Math.round(creditSum * 100));
    expect(Math.round(creditSum * 100)).toBe(Math.round(Number(refund.amount) * 100));
  }, 30_000);

  it("idempotency: replaying the same adminDecide request with the same key returns the same decision, does not create a second one", async () => {
    const fixture = await seedDisputeFixture("DISPIDEMPOTENT");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r3" };

    const dispute = await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Testing decision idempotency." }, traderCtx);
    await service.supplierRespond(dispute.id, { responseType: "ACCEPT", description: "We accept this." }, supplierCtx);

    const key = `idem-${dispute.id}-replay`;
    const first = await service.adminDecide(dispute.id, { decisionType: "FULL_REFUND", reasonNote: "Full refund." }, adminCtx, key);
    const second = await service.adminDecide(dispute.id, { decisionType: "FULL_REFUND", reasonNote: "Full refund." }, adminCtx, key);

    expect(second.decisionId).toBe(first.decisionId);
    const decisions = await prisma.disputeDecision.findMany({ where: { disputeId: dispute.id } });
    expect(decisions).toHaveLength(1);
    const refunds = await prisma.refundObligation.findMany({ where: { disputeDecisionId: first.decisionId } });
    expect(refunds).toHaveLength(1);
  }, 30_000);
});
