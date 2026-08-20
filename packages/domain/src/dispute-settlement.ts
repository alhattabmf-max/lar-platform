// Same convention as the rest of the codebase: plain `number`, rounded
// to 2 decimal places at each settlement point (no Decimal.js).
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface RoundableBranch {
  checkoutLocationAllocationId: string;
  createdAt: Date;
  quantity: number;
}

/**
 * Distributes ONE money component's total across branches proportional
 * to quantity, rounding each branch down to whole cents first, then
 * assigning the entire leftover remainder to exactly one branch: the
 * one that sorts LAST under (createdAt ASC, id ASC) — a fully
 * deterministic, two-key tiebreak (never ambiguous, even when two
 * branches share the exact same createdAt).
 *
 * Returns a map of checkoutLocationAllocationId -> { amount, isRemainderBranch }.
 * amount already includes the remainder for the one branch that gets it.
 */
export function distributeRoundedAmount(
  totalAmount: number,
  totalQuantity: number,
  branches: RoundableBranch[]
): Map<string, { amount: number; remainder: number }> {
  const sorted = [...branches].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    if (t !== 0) return t;
    return a.checkoutLocationAllocationId < b.checkoutLocationAllocationId ? -1 : 1;
  });

  const perBranch = new Map<string, { amount: number; remainder: number }>();
  let sumOfFloored = 0;
  for (const branch of sorted) {
    const exact = (totalAmount * branch.quantity) / totalQuantity;
    const floored = Math.floor(exact * 100) / 100;
    perBranch.set(branch.checkoutLocationAllocationId, { amount: floored, remainder: 0 });
    sumOfFloored = roundMoney(sumOfFloored + floored);
  }

  const leftover = roundMoney(totalAmount - sumOfFloored);
  if (sorted.length > 0 && leftover !== 0) {
    const lastBranchId = sorted[sorted.length - 1].checkoutLocationAllocationId;
    const entry = perBranch.get(lastBranchId)!;
    entry.amount = roundMoney(entry.amount + leftover);
    entry.remainder = leftover;
  }

  return perBranch;
}

export interface FinancialSnapshotInput {
  masterOrderTotalQuantity: number;
  branches: (RoundableBranch & {
    unitPriceExclTaxAmount: number;
    unitTaxAmount: number;
    shippingFeeAmount: number;
  })[];
  masterOrderCommissionAmount: number;
  masterOrderCommissionTaxAmount: number;
}

export interface ComputedAllocationFinancialSnapshot {
  checkoutLocationAllocationId: string;
  productAmountExclTax: number;
  productTaxAmount: number;
  productAmountInclTax: number;
  allocationShareBasisPoints: number; // DISPLAY_ONLY
  commissionShareAmount: number;
  commissionShareTaxAmount: number;
  supplierPayableShareAmount: number;
  shippingFeeAmount: number;
  productAmountRoundingRemainder: number;
  commissionShareRoundingRemainder: number;
  commissionShareTaxRoundingRemainder: number;
  supplierPayableShareRoundingRemainder: number;
}

/**
 * The exact-quantity computation used both for future orders (at
 * payment success) and for the historical Backfill. Product amounts
 * are computed directly per branch from its own quantity x unit price
 * (exact, no rounding-remainder needed). Commission / commission tax
 * are proportional to the MasterOrder's frozen totals and need
 * independent remainder distribution.
 *
 * supplierPayableShareAmount is NOT independently distributed from
 * MasterOrder.supplierPayableAmount — that figure includes shipping
 * by construction in 7C's formula (supplierPayable = totalAmount -
 * commission - commissionTax, where totalAmount includes shipping).
 * Instead it is DERIVED per branch: productAmountInclTax -
 * commissionShareAmount - commissionShareTaxAmount. This guarantees
 * the row-level equation
 *   supplierPayableShareAmount + commissionShareAmount + commissionShareTaxAmount = productAmountInclTax
 * holds exactly by construction, and its rounding remainder is always
 * zero (it inherits whatever rounding already happened in the other
 * two components).
 */
export function computeOrderAllocationFinancialSnapshots(input: FinancialSnapshotInput): ComputedAllocationFinancialSnapshot[] {
  const { branches, masterOrderTotalQuantity } = input;

  const productExclMap = new Map<string, number>();
  const productTaxMap = new Map<string, number>();
  const productInclMap = new Map<string, number>();
  for (const b of branches) {
    const excl = roundMoney(b.unitPriceExclTaxAmount * b.quantity);
    const tax = roundMoney(b.unitTaxAmount * b.quantity);
    productExclMap.set(b.checkoutLocationAllocationId, excl);
    productTaxMap.set(b.checkoutLocationAllocationId, tax);
    productInclMap.set(b.checkoutLocationAllocationId, roundMoney(excl + tax));
  }

  const commissionDist = distributeRoundedAmount(input.masterOrderCommissionAmount, masterOrderTotalQuantity, branches);
  const commissionTaxDist = distributeRoundedAmount(input.masterOrderCommissionTaxAmount, masterOrderTotalQuantity, branches);

  return branches.map((b) => {
    const commission = commissionDist.get(b.checkoutLocationAllocationId)!;
    const commissionTax = commissionTaxDist.get(b.checkoutLocationAllocationId)!;
    const productIncl = productInclMap.get(b.checkoutLocationAllocationId)!;
    const supplierPayableShareAmount = roundMoney(productIncl - commission.amount - commissionTax.amount);
    return {
      checkoutLocationAllocationId: b.checkoutLocationAllocationId,
      productAmountExclTax: productExclMap.get(b.checkoutLocationAllocationId)!,
      productTaxAmount: productTaxMap.get(b.checkoutLocationAllocationId)!,
      productAmountInclTax: productIncl,
      allocationShareBasisPoints: Math.round((b.quantity / masterOrderTotalQuantity) * 10000),
      commissionShareAmount: commission.amount,
      commissionShareTaxAmount: commissionTax.amount,
      supplierPayableShareAmount,
      shippingFeeAmount: b.shippingFeeAmount,
      productAmountRoundingRemainder: 0, // product amounts are exact per-branch, never need a remainder
      commissionShareRoundingRemainder: commission.remainder,
      commissionShareTaxRoundingRemainder: commissionTax.remainder,
      supplierPayableShareRoundingRemainder: 0, // derived, inherits rounding from the other two components
    };
  });
}

// -----------------------------------------------------------------------
// Dispute refund math — commission reversal computed from the PRODUCT
// portion only, never shipping.
// -----------------------------------------------------------------------
export function computeDisputeRefundReversal(input: {
  productRefundAmountInclTax: number;
  shippingRefundAmount: number;
  snapshotProductAmountInclTax: number;
  snapshotCommissionShareAmount: number;
  snapshotCommissionShareTaxAmount: number;
  snapshotSupplierPayableShareAmount: number;
}): {
  totalRefundAmount: number;
  commissionReversalAmount: number;
  commissionTaxReversalAmount: number;
  supplierPayableDebitAmount: number;
} {
  const productRefundRatio = input.snapshotProductAmountInclTax > 0 ? input.productRefundAmountInclTax / input.snapshotProductAmountInclTax : 0;
  const commissionReversalAmount = roundMoney(input.snapshotCommissionShareAmount * productRefundRatio);
  const commissionTaxReversalAmount = roundMoney(input.snapshotCommissionShareTaxAmount * productRefundRatio);
  // Derived, not independently proportioned: SUPPLIER_PAYABLE's debit
  // is whatever remains of the refunded PRODUCT amount after
  // reversing the commission and its tax. This is what makes the
  // journal entry balance by construction — shipping is posted
  // entirely separately (SHIPPING_LIABILITY) and never touches
  // SUPPLIER_PAYABLE, since snapshotSupplierPayableShareAmount
  // (frozen against MasterOrder.supplierPayableAmount, which itself
  // includes shipping per the 7C formula) is NOT usable directly here
  // without double-counting shipping.
  const supplierPayableDebitAmount = roundMoney(input.productRefundAmountInclTax - commissionReversalAmount - commissionTaxReversalAmount);
  return {
    totalRefundAmount: roundMoney(input.productRefundAmountInclTax + input.shippingRefundAmount),
    commissionReversalAmount,
    commissionTaxReversalAmount,
    supplierPayableDebitAmount,
  };
}

// -----------------------------------------------------------------------
// Supplier settlement net amount — the supplier ships directly, so the
// net transfer includes un-refunded shipping alongside the product
// portion. Both parts are computed independently and only posted if
// non-zero.
// -----------------------------------------------------------------------
export function computeSupplierPayoutNet(input: {
  snapshotSupplierPayableShareAmount: number;
  snapshotShippingFeeAmount: number;
  sumProductRelatedSupplierPayableDebits: number; // SUM of DEBIT SUPPLIER_PAYABLE amounts from completed DISPUTE refunds tied to this allocation
  sumShippingRefundDebits: number; // SUM of shippingRefundAmount from completed DISPUTE refunds tied to this allocation
}): { productNet: number; shippingNet: number; netAmount: number } {
  const productNet = roundMoney(input.snapshotSupplierPayableShareAmount - input.sumProductRelatedSupplierPayableDebits);
  const shippingNet = roundMoney(input.snapshotShippingFeeAmount - input.sumShippingRefundDebits);
  return { productNet, shippingNet, netAmount: roundMoney(productNet + shippingNet) };
}


export type DisputeStatus = "OPEN" | "SUPPLIER_RESPONDED" | "AWAITING_REPLACEMENT" | "RESOLVED_ACCEPTED" | "RESOLVED_PARTIAL" | "RESOLVED_REJECTED" | "RESOLVED_REPLACED";

const DISPUTE_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  OPEN: ["SUPPLIER_RESPONDED", "RESOLVED_ACCEPTED", "RESOLVED_PARTIAL", "RESOLVED_REJECTED", "AWAITING_REPLACEMENT"],
  SUPPLIER_RESPONDED: ["RESOLVED_ACCEPTED", "RESOLVED_PARTIAL", "RESOLVED_REJECTED", "AWAITING_REPLACEMENT"],
  AWAITING_REPLACEMENT: ["RESOLVED_REPLACED", "RESOLVED_ACCEPTED", "RESOLVED_PARTIAL"],
  RESOLVED_ACCEPTED: [],
  RESOLVED_PARTIAL: [],
  RESOLVED_REJECTED: [],
  RESOLVED_REPLACED: [],
};

export function isValidDisputeTransition(from: DisputeStatus, to: DisputeStatus): boolean {
  return DISPUTE_TRANSITIONS[from]?.includes(to) ?? false;
}

export type ReplacementObligationStatus = "AWAITING_PREPARATION" | "PREPARING" | "READY_TO_SHIP" | "SHIPPED" | "DELIVERED" | "FAILED";

const REPLACEMENT_TRANSITIONS: Record<ReplacementObligationStatus, ReplacementObligationStatus[]> = {
  AWAITING_PREPARATION: ["PREPARING", "FAILED"],
  PREPARING: ["READY_TO_SHIP", "FAILED"],
  READY_TO_SHIP: ["SHIPPED", "FAILED"],
  SHIPPED: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  FAILED: [],
};

export function isValidReplacementObligationTransition(from: ReplacementObligationStatus, to: ReplacementObligationStatus): boolean {
  return REPLACEMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

// -----------------------------------------------------------------------
// dispute_decisions.sequenceNumber rule — pure predicate, the actual
// enforcement happens in the service under a Dispute row lock.
// -----------------------------------------------------------------------
export function isSecondDisputeDecisionAllowed(input: {
  firstDecisionType: "FULL_REFUND" | "PARTIAL_REFUND" | "REJECTED" | "REPLACEMENT";
  replacementObligationStatus: ReplacementObligationStatus | null;
  secondDecisionType: "FULL_REFUND" | "PARTIAL_REFUND" | "REJECTED" | "REPLACEMENT";
}): boolean {
  if (input.firstDecisionType !== "REPLACEMENT") return false;
  if (input.replacementObligationStatus !== "FAILED") return false;
  return input.secondDecisionType === "FULL_REFUND" || input.secondDecisionType === "PARTIAL_REFUND";
}

// -----------------------------------------------------------------------
// Settlement eligibility — pure predicate over pre-fetched fields.
// -----------------------------------------------------------------------
export function isOrderAllocationSettlementEligible(input: {
  status: string;
  disputeWindowClosesAt: Date | null;
  payoutSettledAt: Date | null;
  hasOpenDispute: boolean; // any Dispute with status IN (OPEN, SUPPLIER_RESPONDED, AWAITING_REPLACEMENT)
  hasBlockingRefundObligation: boolean; // any DISPUTE-source RefundObligation with status IN (PENDING_EXECUTION, SENT, FAILED)
  supplierCompanyPayoutHoldUntil: Date | null; // Company.payoutHoldUntil (Phase 5), NOT a new computation
  now: Date;
}): boolean {
  if (input.status !== "DELIVERED") return false;
  if (!input.disputeWindowClosesAt || input.disputeWindowClosesAt > input.now) return false;
  if (input.payoutSettledAt !== null) return false;
  if (input.hasOpenDispute) return false;
  if (input.hasBlockingRefundObligation) return false;
  if (input.supplierCompanyPayoutHoldUntil && input.supplierCompanyPayoutHoldUntil > input.now) return false;
  return true;
}
