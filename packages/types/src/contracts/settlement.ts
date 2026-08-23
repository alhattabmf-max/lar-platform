/**
 * Settlement contracts — what a supplier may see of being paid.
 *
 * `supplier_payouts` is a record of a bank transfer an ADMINISTRATOR executed,
 * and most of what it holds describes the platform's operation rather than the
 * supplier's money:
 *
 *   externalTransferReference  the bank's own reference for the transfer.
 *                              Internal reconciliation. Exposing it hands out a
 *                              handle on the platform's banking operation, and
 *                              a supplier has their own bank statement.
 *   executedByAdminUserId      which member of staff pressed the button.
 *                              Naming an individual invites pressure on them,
 *                              and it is not the supplier's business.
 *   supplierBankAccountId      an internal row id. The supplier knows their own
 *                              bank account; an id for it tells them nothing and
 *                              is a handle on a table.
 *
 * None of the three is on this contract, so no view can render one by accident.
 * There is no ledger posting, no journal entry, and no IBAN — full or masked.
 *
 * What IS here is what a supplier needs to reconcile: how much, for which
 * shipment, on what basis, with what outcome, and when.
 */

/**
 * How a payout ended. Mirrors `SupplierPayoutOutcome`, which has exactly two
 * values.
 *
 * `ZERO_BALANCE` is not a failure and must never be rendered as one: it means
 * the amount owed for that allocation came to zero — a full refund, typically —
 * so there was nothing to transfer. A supplier reading "failed" there would
 * chase a payment that was never due.
 */
export const SUPPLIER_PAYOUT_OUTCOMES = ["EXECUTED", "ZERO_BALANCE"] as const;
export type SupplierPayoutOutcome = (typeof SUPPLIER_PAYOUT_OUTCOMES)[number];

/**
 * One settlement in the supplier's list.
 *
 * A payout is per ALLOCATION, not per order — `SupplierPayout.orderAllocationId`
 * is unique — so an order with three destinations settles three times. The
 * order id travels with each so a reader can group them, and so the row links
 * back to something they can open.
 */
export interface SettlementSummary {
  id: string;
  /** The allocation this settles. One payout per allocation. */
  orderAllocationId: string;
  /** So the UI can link back without a second read. */
  masterOrderId: string;
  outcome: SupplierPayoutOutcome;
  /** What was transferred. Decimal string. `"0.00"` when ZERO_BALANCE. */
  netAmount: string;
  currency: string;
  /** ISO 8601. When the transfer was executed. */
  executedAt: string;
}

export const SETTLEMENT_SUMMARY_KEYS = [
  "id",
  "orderAllocationId",
  "masterOrderId",
  "outcome",
  "netAmount",
  "currency",
  "executedAt",
] as const satisfies readonly (keyof SettlementSummary)[];

/**
 * The detail adds the basis: how the net amount was arrived at.
 *
 * Every figure comes from `OrderAllocationFinancialSnapshot`, which is frozen
 * when the order is created and never recomputed. That is what makes this
 * reconcilable — the supplier is reading the same numbers the payout was
 * calculated from, not a fresh calculation that might differ.
 *
 * The rounding remainders on that snapshot are deliberately absent. They exist
 * so the per-allocation shares sum exactly to the order total, and they are an
 * implementation detail of that distribution; showing someone a
 * "rounding remainder" line invites a question with no useful answer.
 *
 * `allocationShareBasisPoints` is absent for the same reason — it is marked
 * DISPLAY_ONLY on the model and describes how the split was apportioned, not
 * what is owed.
 */
export interface SettlementDetail extends SettlementSummary {
  /** The shipment's product value excluding VAT. Decimal string. */
  productAmountExclTax: string;
  /** VAT on the product value. Decimal string. */
  productTaxAmount: string;
  /** Product value including VAT. Decimal string. */
  productAmountInclTax: string;
  /** Shipping collected for this destination. Decimal string. */
  shippingFeeAmount: string;
  /** This shipment's share of the platform commission. Decimal string. */
  commissionShareAmount: string;
  /** VAT on that commission share. Decimal string. */
  commissionShareTaxAmount: string;
  /** What this shipment contributed to the payable. Decimal string. */
  supplierPayableShareAmount: string;
  /** Where it went, so a settlement is recognisable without opening the order. */
  locationName: string;
  cityNameAr: string;
  cityNameEn: string;
}

export const SETTLEMENT_DETAIL_KEYS = [
  ...SETTLEMENT_SUMMARY_KEYS,
  "productAmountExclTax",
  "productTaxAmount",
  "productAmountInclTax",
  "shippingFeeAmount",
  "commissionShareAmount",
  "commissionShareTaxAmount",
  "supplierPayableShareAmount",
  "locationName",
  "cityNameAr",
  "cityNameEn",
] as const satisfies readonly (keyof SettlementDetail)[];
