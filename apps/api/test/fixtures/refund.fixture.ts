import type { PrismaService } from "../../src/database/prisma.service";
import { DisputeService } from "../../src/disputes/dispute.service";
import { seedDisputeFixture, disputeFixturePrisma } from "./dispute.fixture";

const prisma = disputeFixturePrisma;

export interface RefundFixture {
  refundObligationId: string;
  paymentAttemptId: string;
  amount: number;
  currency: string;
  supplierCompanyId: string;
  traderCompanyId: string;
}

export async function seedRefundFixture(prefix: string): Promise<RefundFixture> {
  const base = await seedDisputeFixture(prefix);
  const service = new DisputeService(prisma as unknown as PrismaService);
  const traderCtx = { userId: base.traderUserId, companyId: base.traderCompanyId, requestId: `r-refundfixture-${prefix}` };
  const supplierCtx = { userId: crypto.randomUUID(), companyId: base.supplierCompanyId, requestId: `r-refundfixture-sup-${prefix}` };
  const adminCtx = { userId: crypto.randomUUID(), requestId: `r-refundfixture-admin-${prefix}` };

  const dispute = await service.openDispute(base.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Fixture dispute for refund execution testing." }, traderCtx);
  await service.supplierRespond(dispute.id, { responseType: "ACCEPT", description: "We accept full responsibility for this." }, supplierCtx);
  const decision = await service.adminDecide(dispute.id, { decisionType: "FULL_REFUND", reasonNote: "Full refund for fixture." }, adminCtx, `idem-${dispute.id}-fixture-refund`);

  const refund = await prisma.refundObligation.findUniqueOrThrow({ where: { disputeDecisionId: decision.decisionId } });
  const masterOrder = await prisma.masterOrder.findUniqueOrThrow({ where: { id: base.masterOrderId } });

  return {
    refundObligationId: refund.id,
    paymentAttemptId: masterOrder.paymentAttemptId,
    amount: Number(refund.amount),
    currency: refund.currency,
    supplierCompanyId: base.supplierCompanyId,
    traderCompanyId: base.traderCompanyId,
  };
}

export { prisma as refundFixturePrisma };
