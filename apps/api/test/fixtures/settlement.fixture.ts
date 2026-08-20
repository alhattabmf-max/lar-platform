import type { PrismaService } from "../../src/database/prisma.service";
import { seedFulfillmentFixture, fulfillmentFixturePrisma } from "./fulfillment.fixture";
import { OrderAllocationService } from "../../src/fulfillment/order-allocation.service";
import { computeDisputeRefundReversal } from "@platform/domain";

const prisma = fulfillmentFixturePrisma;

export interface SettlementFixture {
  opportunityId: string;
  supplierCompanyId: string;
  traderCompanyId: string;
  traderUserId: string;
  masterOrderId: string;
  deliveredOrderAllocationId: string;
}

/**
 * A fully delivered allocation with its dispute window ALREADY
 * closed (in the past) — settlement-eligible immediately. The
 * dispute_window_closes_at trigger only allows filling it once
 * (never re-editing), so the DELIVERED transition itself is done via
 * raw SQL with a past-dated window rather than through
 * OrderAllocationService's normal (future-dated) path.
 */
export async function seedSettlementFixture(prefix: string, disputeWindowOffsetMs = -3_600_000): Promise<SettlementFixture> {
  const base = await seedFulfillmentFixture(prefix);
  const service = new OrderAllocationService(prisma as unknown as PrismaService);
  const supplierCtx = { userId: crypto.randomUUID(), companyId: base.supplierCompanyId, requestId: `r-settlement-fixture-${prefix}` };

  const deliveredId = base.orderAllocationIds[0];
  await service.startPreparation(deliveredId, supplierCtx);
  await service.markReady(deliveredId, supplierCtx);
  await service.ship(deliveredId, { carrierCode: "MOCK_CARRIER", trackingNumber: `SETTLETRACK-${deliveredId.slice(0, 8)}-${Date.now()}` }, supplierCtx);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE order_allocations SET status = 'DELIVERED', delivered_at = now(), dispute_window_closes_at = now() + (${disputeWindowOffsetMs}::float * interval '1 millisecond')
      WHERE id = ${deliveredId}::uuid
    `;
    await tx.deliveryConfirmation.create({
      data: { orderAllocationId: deliveredId, confirmedBySource: "TRADER_CONFIRMATION", confirmedAt: new Date(), confirmedByUserId: base.traderUserId },
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_delivered_has_confirmation IMMEDIATE`);
  });

  return { ...base, deliveredOrderAllocationId: deliveredId };
}

/**
 * Seeds a settlement-eligible allocation whose ENTIRE dispute timeline
 * (delivery, dispute open, supplier response, admin decision, and the
 * resulting RefundObligation + its DISPUTE_REFUND_OBLIGATION journal)
 * is chronologically historical and already closed — inserted
 * directly within one transaction (passing every DB trigger exactly
 * as DisputeService's real writes would), rather than through
 * DisputeService's own application-level now()-based checks (which
 * would reject a request against an already-past window). The
 * REFUND EXECUTION itself is deliberately NOT seeded here — callers
 * must complete it via the real RefundExecutionService +
 * RefundWebhookService, per the approved design.
 */
export async function seedHistoricalDisputeRefundFixture(
  prefix: string,
  refundSpec: { decisionType: "FULL_REFUND" | "PARTIAL_REFUND"; productRefundAmountInclTax: number; shippingRefundAmount: number }
): Promise<SettlementFixture & { disputeId: string; disputeDecisionId: string; refundObligationId: string }> {
  const base = await seedFulfillmentFixture(prefix);
  const traderUserId = base.traderUserId;
  const adminUserId = crypto.randomUUID();

  const deliveredId = base.orderAllocationIds[0];

  const now = Date.now();
  const preparationStartedAt = new Date(now - 12 * 86_400_000);
  const readyToShipAt = new Date(now - 11 * 86_400_000);
  const shippedAt = new Date(now - 10.5 * 86_400_000);
  const deliveredAt = new Date(now - 10 * 86_400_000);
  const disputeWindowClosesAt = new Date(deliveredAt.getTime() + 7 * 86_400_000); // now - 3 days
  const openedAt = new Date(deliveredAt.getTime() + 1 * 86_400_000); // now - 9 days, before window closes
  const supplierResponseDueAt = new Date(openedAt.getTime() + 3 * 86_400_000); // now - 6 days
  const respondedAt = new Date(openedAt.getTime() + 1 * 86_400_000); // now - 8 days
  const decidedAt = new Date(supplierResponseDueAt.getTime() + 1 * 86_400_000); // now - 5 days

  const disputeStatus = refundSpec.decisionType === "FULL_REFUND" ? "RESOLVED_ACCEPTED" : "RESOLVED_PARTIAL";

  const { disputeId, disputeDecisionId, refundObligationId } = await prisma.$transaction(async (tx) => {
    // Walk every real transition with historical timestamps —
    // matching exactly what OrderAllocationService's live calls would
    // do, since each timestamp field is frozen after its first fill.
    await tx.$executeRaw`UPDATE order_allocations SET status = 'PREPARING', preparation_started_at = ${preparationStartedAt} WHERE id = ${deliveredId}::uuid`;
    await tx.$executeRaw`UPDATE order_allocations SET status = 'READY_TO_SHIP', ready_to_ship_at = ${readyToShipAt} WHERE id = ${deliveredId}::uuid`;
    await tx.$executeRaw`UPDATE order_allocations SET status = 'SHIPPED', shipped_at = ${shippedAt} WHERE id = ${deliveredId}::uuid`;
    await tx.shipmentTracking.create({
      data: { orderAllocationId: deliveredId, carrierCode: "MOCK_CARRIER", trackingNumber: `SETTLETRACK-${deliveredId.slice(0, 8)}-${Date.now()}`, shippedByUserId: crypto.randomUUID() },
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_shipped_has_tracking IMMEDIATE`);
    await tx.$executeRaw`
      UPDATE order_allocations SET status = 'DELIVERED', delivered_at = ${deliveredAt}, dispute_window_closes_at = ${disputeWindowClosesAt}
      WHERE id = ${deliveredId}::uuid
    `;
    await tx.deliveryConfirmation.create({
      data: { orderAllocationId: deliveredId, confirmedBySource: "TRADER_CONFIRMATION", confirmedAt: deliveredAt, confirmedByUserId: traderUserId },
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_delivered_has_confirmation IMMEDIATE`);

    const dispute = await tx.dispute.create({
      data: {
        orderAllocationId: deliveredId,
        openedByUserId: traderUserId,
        reasonCode: "ITEM_DAMAGED",
        description: "Historical fixture dispute for settlement testing.",
        status: disputeStatus,
        supplierResponseDueAt,
        openedAt,
      },
    });
    await tx.disputeSupplierResponse.create({
      data: { disputeId: dispute.id, responseType: "ACCEPT", description: "We accept responsibility.", respondedByUserId: crypto.randomUUID(), respondedAt },
    });
    const decision = await tx.disputeDecision.create({
      data: {
        disputeId: dispute.id,
        sequenceNumber: 1,
        decisionType: refundSpec.decisionType,
        productRefundAmountInclTax: refundSpec.productRefundAmountInclTax,
        shippingRefundAmount: refundSpec.shippingRefundAmount,
        reasonNote: "Historical fixture decision.",
        decidedByAdminUserId: adminUserId,
        decidedAt,
      },
    });

    const snapshot = await tx.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: deliveredId } });
    const reversal = computeDisputeRefundReversal({
      productRefundAmountInclTax: refundSpec.productRefundAmountInclTax,
      shippingRefundAmount: refundSpec.shippingRefundAmount,
      snapshotProductAmountInclTax: Number(snapshot.productAmountInclTax),
      snapshotCommissionShareAmount: Number(snapshot.commissionShareAmount),
      snapshotCommissionShareTaxAmount: Number(snapshot.commissionShareTaxAmount),
      snapshotSupplierPayableShareAmount: Number(snapshot.supplierPayableShareAmount),
    });

    const masterOrder = await tx.masterOrder.findUniqueOrThrow({ where: { id: base.masterOrderId } });
    const refund = await tx.refundObligation.create({
      data: {
        paymentAttemptId: masterOrder.paymentAttemptId,
        source: "DISPUTE",
        disputeDecisionId: decision.id,
        reasonCode: refundSpec.decisionType === "FULL_REFUND" ? "DISPUTE_FULL_REFUND" : "DISPUTE_PARTIAL_REFUND",
        productRefundAmountInclTax: refundSpec.productRefundAmountInclTax,
        shippingRefundAmount: refundSpec.shippingRefundAmount,
        amount: reversal.totalRefundAmount,
      },
    });

    const journal = await tx.journalEntry.create({
      data: { eventType: "DISPUTE_REFUND_OBLIGATION", referenceType: "refund_obligation", referenceId: refund.id, idempotencyKey: `dispute-refund:${refund.id}` },
    });
    const postings: { journalEntryId: string; account: "SUPPLIER_PAYABLE" | "PLATFORM_COMMISSION_REVENUE" | "COMMISSION_TAX_PAYABLE" | "SHIPPING_LIABILITY" | "CUSTOMER_REFUND_PAYABLE"; direction: "DEBIT" | "CREDIT"; amount: number }[] = [];
    if (reversal.supplierPayableDebitAmount > 0) {
      postings.push({ journalEntryId: journal.id, account: "SUPPLIER_PAYABLE", direction: "DEBIT", amount: reversal.supplierPayableDebitAmount });
    }
    if (reversal.commissionReversalAmount > 0) {
      postings.push({ journalEntryId: journal.id, account: "PLATFORM_COMMISSION_REVENUE", direction: "DEBIT", amount: reversal.commissionReversalAmount });
    }
    if (reversal.commissionTaxReversalAmount > 0) {
      postings.push({ journalEntryId: journal.id, account: "COMMISSION_TAX_PAYABLE", direction: "DEBIT", amount: reversal.commissionTaxReversalAmount });
    }
    if (refundSpec.shippingRefundAmount > 0) {
      postings.push({ journalEntryId: journal.id, account: "SHIPPING_LIABILITY", direction: "DEBIT", amount: refundSpec.shippingRefundAmount });
    }
    postings.push({ journalEntryId: journal.id, account: "CUSTOMER_REFUND_PAYABLE", direction: "CREDIT", amount: reversal.totalRefundAmount });
    await tx.ledgerPosting.createMany({ data: postings });

    await tx.$executeRawUnsafe(
      `SET CONSTRAINTS trg_check_journal_entry_balance, trg_check_refund_obligation_payment_attempt_cap, trg_check_refund_obligation_allocation_cap IMMEDIATE`
    );

    return { disputeId: dispute.id, disputeDecisionId: decision.id, refundObligationId: refund.id };
  });

  return { ...base, deliveredOrderAllocationId: deliveredId, disputeId, disputeDecisionId, refundObligationId };
}

/**
 * Seeds a settlement-eligible allocation with a fully historical
 * dispute whose decision was REPLACEMENT, and whose
 * ReplacementObligation is in its initial AWAITING_PREPARATION state
 * — ready to be driven forward through REAL HTTP calls
 * (start-preparation -> mark-ready -> ship -> confirm-delivery). The
 * dispute window is already closed since creation (immutable field,
 * never mutated afterward, no sleep required).
 */
export async function seedHistoricalActiveReplacementFixture(prefix: string): Promise<SettlementFixture & { disputeId: string; replacementObligationId: string }> {
  const base = await seedFulfillmentFixture(prefix);
  const traderUserId = base.traderUserId;
  const adminUserId = crypto.randomUUID();

  const deliveredId = base.orderAllocationIds[0];

  const now = Date.now();
  const preparationStartedAt = new Date(now - 12 * 86_400_000);
  const readyToShipAt = new Date(now - 11 * 86_400_000);
  const shippedAt = new Date(now - 10.5 * 86_400_000);
  const deliveredAt = new Date(now - 10 * 86_400_000);
  const disputeWindowClosesAt = new Date(deliveredAt.getTime() + 7 * 86_400_000);
  const openedAt = new Date(deliveredAt.getTime() + 1 * 86_400_000);
  const supplierResponseDueAt = new Date(openedAt.getTime() + 3 * 86_400_000);
  const respondedAt = new Date(openedAt.getTime() + 1 * 86_400_000);
  const decidedAt = new Date(supplierResponseDueAt.getTime() + 1 * 86_400_000);

  const { disputeId, replacementObligationId } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE order_allocations SET status = 'PREPARING', preparation_started_at = ${preparationStartedAt} WHERE id = ${deliveredId}::uuid`;
    await tx.$executeRaw`UPDATE order_allocations SET status = 'READY_TO_SHIP', ready_to_ship_at = ${readyToShipAt} WHERE id = ${deliveredId}::uuid`;
    await tx.$executeRaw`UPDATE order_allocations SET status = 'SHIPPED', shipped_at = ${shippedAt} WHERE id = ${deliveredId}::uuid`;
    await tx.shipmentTracking.create({
      data: { orderAllocationId: deliveredId, carrierCode: "MOCK_CARRIER", trackingNumber: `SETTLETRACK-${deliveredId.slice(0, 8)}-${Date.now()}`, shippedByUserId: crypto.randomUUID() },
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_shipped_has_tracking IMMEDIATE`);
    await tx.$executeRaw`
      UPDATE order_allocations SET status = 'DELIVERED', delivered_at = ${deliveredAt}, dispute_window_closes_at = ${disputeWindowClosesAt}
      WHERE id = ${deliveredId}::uuid
    `;
    await tx.deliveryConfirmation.create({
      data: { orderAllocationId: deliveredId, confirmedBySource: "TRADER_CONFIRMATION", confirmedAt: deliveredAt, confirmedByUserId: traderUserId },
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_delivered_has_confirmation IMMEDIATE`);

    const dispute = await tx.dispute.create({
      data: {
        orderAllocationId: deliveredId,
        openedByUserId: traderUserId,
        reasonCode: "ITEM_DAMAGED",
        description: "Historical fixture dispute for active-replacement E2E test.",
        status: "AWAITING_REPLACEMENT",
        supplierResponseDueAt,
        openedAt,
      },
    });
    await tx.disputeSupplierResponse.create({
      data: { disputeId: dispute.id, responseType: "REPLACEMENT_OFFER", description: "We offer a replacement.", respondedByUserId: crypto.randomUUID(), respondedAt },
    });
    const decision = await tx.disputeDecision.create({
      data: {
        disputeId: dispute.id,
        sequenceNumber: 1,
        decisionType: "REPLACEMENT",
        reasonNote: "Historical fixture replacement decision.",
        decidedByAdminUserId: adminUserId,
        decidedAt,
      },
    });

    const replacement = await tx.replacementObligation.create({
      data: {
        disputeDecisionId: decision.id,
        originalOrderAllocationId: deliveredId,
        replacementQuantity: 1,
        status: "AWAITING_PREPARATION",
      },
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_replacement_quantity_within_original IMMEDIATE`);

    return { disputeId: dispute.id, replacementObligationId: replacement.id };
  });

  return { ...base, deliveredOrderAllocationId: deliveredId, disputeId, replacementObligationId };
}

/**
 * Seeds a settlement-eligible allocation with a fully historical
 * dispute whose decision was REPLACEMENT, and whose
 * ReplacementObligation is FAILED, with NO second (refund) decision
 * yet — the dispute therefore remains AWAITING_REPLACEMENT, which
 * must block settlement.
 */
export async function seedHistoricalFailedReplacementFixture(prefix: string): Promise<SettlementFixture & { disputeId: string; replacementObligationId: string }> {
  const base = await seedFulfillmentFixture(prefix);
  const traderUserId = base.traderUserId;
  const adminUserId = crypto.randomUUID();

  const deliveredId = base.orderAllocationIds[0];

  const now = Date.now();
  const preparationStartedAt = new Date(now - 12 * 86_400_000);
  const readyToShipAt = new Date(now - 11 * 86_400_000);
  const shippedAt = new Date(now - 10.5 * 86_400_000);
  const deliveredAt = new Date(now - 10 * 86_400_000);
  const disputeWindowClosesAt = new Date(deliveredAt.getTime() + 7 * 86_400_000);
  const openedAt = new Date(deliveredAt.getTime() + 1 * 86_400_000);
  const supplierResponseDueAt = new Date(openedAt.getTime() + 3 * 86_400_000);
  const respondedAt = new Date(openedAt.getTime() + 1 * 86_400_000);
  const decidedAt = new Date(supplierResponseDueAt.getTime() + 1 * 86_400_000);
  const shippedReplAt = new Date(decidedAt.getTime() + 1 * 86_400_000);
  const failedAt = new Date(shippedReplAt.getTime() + 1 * 86_400_000);

  const { disputeId, replacementObligationId } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE order_allocations SET status = 'PREPARING', preparation_started_at = ${preparationStartedAt} WHERE id = ${deliveredId}::uuid`;
    await tx.$executeRaw`UPDATE order_allocations SET status = 'READY_TO_SHIP', ready_to_ship_at = ${readyToShipAt} WHERE id = ${deliveredId}::uuid`;
    await tx.$executeRaw`UPDATE order_allocations SET status = 'SHIPPED', shipped_at = ${shippedAt} WHERE id = ${deliveredId}::uuid`;
    await tx.shipmentTracking.create({
      data: { orderAllocationId: deliveredId, carrierCode: "MOCK_CARRIER", trackingNumber: `SETTLETRACK-${deliveredId.slice(0, 8)}-${Date.now()}`, shippedByUserId: crypto.randomUUID() },
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_shipped_has_tracking IMMEDIATE`);
    await tx.$executeRaw`
      UPDATE order_allocations SET status = 'DELIVERED', delivered_at = ${deliveredAt}, dispute_window_closes_at = ${disputeWindowClosesAt}
      WHERE id = ${deliveredId}::uuid
    `;
    await tx.deliveryConfirmation.create({
      data: { orderAllocationId: deliveredId, confirmedBySource: "TRADER_CONFIRMATION", confirmedAt: deliveredAt, confirmedByUserId: traderUserId },
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_delivered_has_confirmation IMMEDIATE`);

    const dispute = await tx.dispute.create({
      data: {
        orderAllocationId: deliveredId,
        openedByUserId: traderUserId,
        reasonCode: "ITEM_DAMAGED",
        description: "Historical fixture dispute for failed-replacement settlement blocking test.",
        status: "AWAITING_REPLACEMENT",
        supplierResponseDueAt,
        openedAt,
      },
    });
    await tx.disputeSupplierResponse.create({
      data: { disputeId: dispute.id, responseType: "REPLACEMENT_OFFER", description: "We offer a replacement.", respondedByUserId: crypto.randomUUID(), respondedAt },
    });
    const decision = await tx.disputeDecision.create({
      data: {
        disputeId: dispute.id,
        sequenceNumber: 1,
        decisionType: "REPLACEMENT",
        reasonNote: "Historical fixture replacement decision.",
        decidedByAdminUserId: adminUserId,
        decidedAt,
      },
    });

    const originalAllocation = await tx.orderAllocation.findUniqueOrThrow({ where: { id: deliveredId }, include: { checkoutLocationAllocation: true } });
    const replacement = await tx.replacementObligation.create({
      data: {
        disputeDecisionId: decision.id,
        originalOrderAllocationId: deliveredId,
        replacementQuantity: 1,
        status: "FAILED",
        preparationStartedAt: shippedReplAt,
        readyToShipAt: shippedReplAt,
        shippedAt: shippedReplAt,
        failedAt,
      },
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_replacement_quantity_within_original IMMEDIATE`);
    void originalAllocation;

    return { disputeId: dispute.id, replacementObligationId: replacement.id };
  });

  return { ...base, deliveredOrderAllocationId: deliveredId, disputeId, replacementObligationId };
}

export { prisma as settlementFixturePrisma };
