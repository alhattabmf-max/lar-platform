import { Prisma } from "@prisma/client";
import type {
  SupplierOpportunityDetail,
  SupplierOpportunityReasonCode,
  SupplierOpportunityStatus,
  SupplierOpportunitySummary,
} from "@platform/types";

/**
 * Projection for the supplier's own opportunities.
 *
 * `toSupplierOpportunityView` — which this replaces — had two defects that
 * were invisible because it looked like a projection:
 *
 *   1. EVERY money field went through `Decimal.toNumber()`. These are
 *      `Decimal(12,2)` and `Decimal(14,2)` columns reconciled against bank
 *      statements, and JSON's only numeric type is IEEE-754 binary double,
 *      in which 125.50 is not representable exactly. The value that left the
 *      database and the value the client received were different numbers
 *      that merely printed the same. `contracts/money.ts` exists to prevent
 *      exactly this, and the web app has no number entry point for money
 *      precisely so a float cannot be formatted as though it were exact.
 *
 *   2. It mapped a RAW ROW. `listMine` and `getOwned` both did
 *      `findMany`/`findFirst` with no `select`, so every column was read and
 *      the projection was the only thing standing between the supplier and
 *      `shareTierPolicyVersionId`, `commissionRateBasisPoints`,
 *      `productApprovalSnapshotId` and the admin's free-text `pauseReason`.
 *      Not selecting is stronger than not mapping: a later refactor that
 *      spreads a row cannot leak a column the query never asked for.
 *
 * `pauseReason` and `cancelReason` are absent for a third reason: they are
 * written by an ADMINISTRATOR about this listing ("supplier under
 * investigation"), which makes them an internal operational note, not
 * correspondence for the supplier. `reasonDetails` is absent too — it is
 * pre-written English aimed at operators. The supplier gets `reasonCode`,
 * which a UI translates, and writes its own next step.
 */

/** Money as a fixed-scale decimal string. Never a float. */
function money(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}

const moneyOrNull = (amount: Prisma.Decimal | null): string | null =>
  amount === null ? null : money(amount);

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

/**
 * Ownership, as a WHERE clause.
 *
 * `Opportunity.companyId` is the supplier's. Expressed as a filter, an
 * unknown id and another company's opportunity both produce no row — one
 * 404, with nothing distinguishable by probing. Fetching first and comparing
 * afterwards is one early return away from answering the wrong company.
 */
export function ownedOpportunityWhere(companyId: string): Prisma.OpportunityWhereInput {
  return { companyId };
}

/**
 * Columns for the LIST.
 *
 * Absent by construction: `companyId`, `shareTierPolicyVersionId`,
 * `shareTierIndex`, `shareBasisPoints`, `commissionPolicyVersionId`,
 * `commissionRateBasisPoints`, `productApprovalSnapshotId`,
 * `fulfillmentCityId`, `fulfillmentRegionId`, `pauseReason`, `cancelReason`,
 * `reasonDetails`, and every tax-rule code and version.
 *
 * The product NAME comes from the live product relation rather than the
 * frozen approval snapshot: a DRAFT has no snapshot at all, and a supplier
 * scanning their own list needs to recognise the product as it is called
 * now. It is their own product either way.
 */
export const SUPPLIER_OPPORTUNITY_SUMMARY_SELECT = {
  id: true,
  productId: true,
  product: { select: { nameAr: true, nameEn: true } },
  salesUnitNameAr: true,
  salesUnitNameEn: true,
  status: true,
  reasonCode: true,
  targetQuantity: true,
  fundedQuantity: true,
  unitPriceAmount: true,
  currency: true,
  startAt: true,
  endAt: true,
  extendedAt: true,
  createdAt: true,
} satisfies Prisma.OpportunitySelect;

/**
 * The DETAIL adds the frozen tax breakdown, the shipping origin and the
 * lifecycle timestamps.
 *
 * `shareBasisPoints` IS selected here and is the one exception that proves
 * the rule: `sharePercentage` is derived from it and cannot be computed
 * without it. The raw value never reaches the response — the mapper divides
 * it by 100 and drops it — and it is the only policy internal read at all.
 */
export const SUPPLIER_OPPORTUNITY_DETAIL_SELECT = {
  ...SUPPLIER_OPPORTUNITY_SUMMARY_SELECT,
  descriptionAr: true,
  descriptionEn: true,
  expectedPreparationDays: true,
  fulfillmentLocationId: true,
  fulfillmentCityNameAr: true,
  fulfillmentCityNameEn: true,
  fulfillmentRegionNameAr: true,
  fulfillmentRegionNameEn: true,
  taxRatePercent: true,
  unitPriceExclTaxAmount: true,
  unitTaxAmount: true,
  totalValueInclTaxAmount: true,
  shareBasisPoints: true,
  shareQuantity: true,
  firstActivatedAt: true,
  pausedAt: true,
  blockedAt: true,
  updatedAt: true,
} satisfies Prisma.OpportunitySelect;

export type SupplierOpportunitySummaryRow = Prisma.OpportunityGetPayload<{
  select: typeof SUPPLIER_OPPORTUNITY_SUMMARY_SELECT;
}>;
export type SupplierOpportunityDetailRow = Prisma.OpportunityGetPayload<{
  select: typeof SUPPLIER_OPPORTUNITY_DETAIL_SELECT;
}>;

export function toSupplierOpportunitySummary(
  row: SupplierOpportunitySummaryRow
): SupplierOpportunitySummary {
  return {
    id: row.id,
    productId: row.productId,
    productNameAr: row.product.nameAr,
    productNameEn: row.product.nameEn,
    salesUnitNameAr: row.salesUnitNameAr,
    salesUnitNameEn: row.salesUnitNameEn,
    status: row.status as SupplierOpportunityStatus,
    // The CODE only. The paired `reasonDetails` is operator-facing English
    // and is not selected.
    reasonCode: row.reasonCode as SupplierOpportunityReasonCode | null,
    targetQuantity: row.targetQuantity,
    fundedQuantity: row.fundedQuantity,
    unitPriceAmount: money(row.unitPriceAmount),
    currency: row.currency,
    startAt: iso(row.startAt),
    endAt: iso(row.endAt),
    extendedAt: isoOrNull(row.extendedAt),
    createdAt: iso(row.createdAt),
  };
}

export function toSupplierOpportunityDetail(
  row: SupplierOpportunityDetailRow
): SupplierOpportunityDetail {
  return {
    ...toSupplierOpportunitySummary(row),
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    expectedPreparationDays: row.expectedPreparationDays,
    fulfillmentLocationId: row.fulfillmentLocationId,
    // The frozen NAMES, not the city and region ids they were resolved
    // from. Null until the listing is first published.
    fulfillmentCityNameAr: row.fulfillmentCityNameAr,
    fulfillmentCityNameEn: row.fulfillmentCityNameEn,
    fulfillmentRegionNameAr: row.fulfillmentRegionNameAr,
    fulfillmentRegionNameEn: row.fulfillmentRegionNameEn,
    // A rate at its own scale, not money.
    taxRatePercent: row.taxRatePercent === null ? null : row.taxRatePercent.toFixed(2),
    // Null rather than "0.00" before the first publish: a zero would be a
    // claim that no tax applies, and these are frozen at publish time.
    unitPriceExclTaxAmount: moneyOrNull(row.unitPriceExclTaxAmount),
    unitTaxAmount: moneyOrNull(row.unitTaxAmount),
    totalValueInclTaxAmount: moneyOrNull(row.totalValueInclTaxAmount),
    // Derived here and the raw basis points dropped, so the policy's own
    // units never cross the wire.
    sharePercentage: row.shareBasisPoints === null ? null : row.shareBasisPoints / 100,
    shareQuantity: row.shareQuantity,
    firstActivatedAt: isoOrNull(row.firstActivatedAt),
    pausedAt: isoOrNull(row.pausedAt),
    blockedAt: isoOrNull(row.blockedAt),
    updatedAt: iso(row.updatedAt),
  };
}
