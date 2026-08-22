import type { PrismaService } from "../../src/database/prisma.service";
import { DisputeService } from "../../src/disputes/dispute.service";
import { seedDisputeFixture, disputeFixturePrisma } from "./dispute.fixture";
import { notificationEvents } from "./notifications.fixture";

const prisma = disputeFixturePrisma;

export interface ReplacementFixture {
  opportunityId: string;
  supplierCompanyId: string;
  traderCompanyId: string;
  traderUserId: string;
  masterOrderId: string;
  deliveredOrderAllocationId: string;
  disputeId: string;
  disputeDecisionId: string;
  replacementObligationId: string;
}

/** A dispute with a REPLACEMENT decision already created (sequenceNumber=1), ready for shipping-lifecycle testing. */
export async function seedReplacementFixture(prefix: string, replacementQuantity = 1): Promise<ReplacementFixture> {
  const base = await seedDisputeFixture(prefix);
  const service = new DisputeService(prisma as unknown as PrismaService, notificationEvents());
  const traderCtx = { userId: base.traderUserId, companyId: base.traderCompanyId, requestId: `r-replfixture-${prefix}` };
  const supplierCtx = { userId: crypto.randomUUID(), companyId: base.supplierCompanyId, requestId: `r-replfixture-sup-${prefix}` };
  const adminCtx = { userId: crypto.randomUUID(), requestId: `r-replfixture-admin-${prefix}` };

  const dispute = await service.openDispute(base.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Fixture dispute for replacement testing." }, traderCtx);
  await service.supplierRespond(dispute.id, { responseType: "REPLACEMENT_OFFER", description: "We offer a replacement item for this order." }, supplierCtx);
  const decision = await service.adminDecide(
    dispute.id,
    { decisionType: "REPLACEMENT", replacementQuantity, reasonNote: "Replacement approved by fixture." },
    adminCtx,
    `idem-${dispute.id}-fixture-replacement`
  );

  const replacementObligation = await prisma.replacementObligation.findUniqueOrThrow({ where: { disputeDecisionId: decision.decisionId } });

  return {
    opportunityId: base.opportunityId,
    supplierCompanyId: base.supplierCompanyId,
    traderCompanyId: base.traderCompanyId,
    traderUserId: base.traderUserId,
    masterOrderId: base.masterOrderId,
    deliveredOrderAllocationId: base.deliveredOrderAllocationId,
    disputeId: dispute.id,
    disputeDecisionId: decision.decisionId,
    replacementObligationId: replacementObligation.id,
  };
}

export { prisma as replacementFixturePrisma };
