import type { MoneyString } from "./money";

/**
 * Supplier-facing opportunity contracts.
 *
 * An opportunity is the supplier's own listing, so most of the row belongs
 * to them. What is withheld is the platform's machinery and the other side
 * of the marketplace:
 *
 *   - the TRADER is absent entirely. Who bought a share, how many traders
 *     did, and every checkout, payment and order id — none of it is here.
 *     `fundedQuantity` is the only thing the supplier learns about demand,
 *     because it is what tells them whether their own listing will fund.
 *
 *   - the COMMISSION derivation is absent. `commissionPolicyVersionId`,
 *     the rate and its basis are the platform's internal pricing of its own
 *     service. What the supplier is charged appears on the settlement, per
 *     shipment, where it is an amount they can reconcile.
 *
 *   - the SHARE TIER internals are absent. `shareTierPolicyVersionId`,
 *     `shareTierIndex` and the raw `shareBasisPoints` are policy internals;
 *     `sharePercentage` is the derived figure and the only one exposed.
 *
 *   - the APPROVAL SNAPSHOT is absent — `productApprovalSnapshotId` and the
 *     snapshot itself, which is a frozen copy carrying storage keys.
 *
 *   - internal FKs are absent: `companyId`, `fulfillmentCityId`,
 *     `fulfillmentRegionId`. The city and region cross the wire as the
 *     frozen NAMES that were snapshotted, which is what a supplier reads.
 *
 * MONEY IS A DECIMAL STRING, always. Until 8E.4 this projection sent every
 * amount through `Decimal.toNumber()`, which is the exact defect
 * `contracts/money.ts` exists to prevent: a `Decimal(12,2)` reconciled
 * against a bank statement, serialised through IEEE-754 binary double.
 */

/**
 * Every state an opportunity can be in.
 *
 * The full lifecycle, unlike `PUBLIC_OPPORTUNITY_STATUSES` — the supplier
 * owns the listing and sees it before it is public and after it is not.
 * A closed list rather than a re-export of the Prisma enum, so the wire
 * vocabulary is a decision rather than a consequence.
 */
export const SUPPLIER_OPPORTUNITY_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTION_REQUIRED",
  "ACTIVE",
  "PAUSED",
  "FUNDED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type SupplierOpportunityStatus = (typeof SUPPLIER_OPPORTUNITY_STATUSES)[number];

/**
 * Why an opportunity is in ACTION_REQUIRED.
 *
 * Mirrors `OPPORTUNITY_REASON_CODES` in `@platform/domain`, which is where
 * the API's eligibility evaluator produces them. Restated here — and
 * asserted equal by a test — so a web client can translate every one
 * without depending on a server-side package.
 *
 * The paired `reasonDetails` on the row is pre-written English intended for
 * operators. A UI translates the CODE and writes its own next step; it must
 * not print the details string at a supplier.
 */
export const SUPPLIER_OPPORTUNITY_REASON_CODES = [
  "SUPPLIER_NOT_VERIFIED",
  "PRODUCT_NOT_APPROVED",
  "PRODUCT_ARCHIVED",
  "LOCATION_INACTIVE",
  "LOCATION_CITY_INACTIVE",
  "SUPPLIER_NOT_FINANCIALLY_READY",
  "TAX_RATE_NOT_CONFIGURED",
  "PURCHASE_QUANTITY_NOT_COMPATIBLE",
  "PRODUCT_SUSPENDED",
  "PRODUCT_CLOSED",
] as const;

export type SupplierOpportunityReasonCode =
  (typeof SUPPLIER_OPPORTUNITY_REASON_CODES)[number];

/**
 * One listing in the supplier's own list.
 *
 * Carries what identifies the listing, where it is in its lifecycle, and
 * the two numbers that describe progress — no tax breakdown and no share
 * arithmetic, which are detail-page concerns.
 */
export interface SupplierOpportunitySummary {
  id: string;
  /** The linked product, so a list row can be opened onto it. */
  productId: string;
  productNameAr: string;
  productNameEn: string;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  status: SupplierOpportunityStatus;
  /** Present only in ACTION_REQUIRED. Translate the CODE, never the details. */
  reasonCode: SupplierOpportunityReasonCode | null;
  targetQuantity: number;
  /** How much of the target traders have funded. The only demand signal here. */
  fundedQuantity: number;
  /** Price per selling unit, including tax. Decimal string. */
  unitPriceAmount: MoneyString;
  currency: string;
  /** ISO 8601. */
  startAt: string;
  endAt: string;
  /** Non-null once extended. An opportunity may be extended exactly once. */
  extendedAt: string | null;
  createdAt: string;
}

export const SUPPLIER_OPPORTUNITY_SUMMARY_KEYS = [
  "id",
  "productId",
  "productNameAr",
  "productNameEn",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "status",
  "reasonCode",
  "targetQuantity",
  "fundedQuantity",
  "unitPriceAmount",
  "currency",
  "startAt",
  "endAt",
  "extendedAt",
  "createdAt",
] as const satisfies readonly (keyof SupplierOpportunitySummary)[];

/**
 * The detail adds the frozen tax breakdown, the shipping origin and the
 * lifecycle timestamps.
 *
 * Every tax figure is null until the listing is first published: they are
 * computed and FROZEN at publish time from the tax rate then in force, and
 * a draft has none. That is why they are nullable rather than zero — a
 * zero would be a claim that no tax applies.
 *
 * `taxRatePercent` is a rate, not money: `Decimal(5,2)` crossing the wire
 * as a decimal string at its own scale.
 */
export interface SupplierOpportunityDetail extends SupplierOpportunitySummary {
  descriptionAr: string | null;
  descriptionEn: string | null;
  expectedPreparationDays: number;
  /** The supplier's own location the goods ship from. */
  fulfillmentLocationId: string;
  /** Frozen city and region NAMES, snapshotted at publish. Null before then. */
  fulfillmentCityNameAr: string | null;
  fulfillmentCityNameEn: string | null;
  fulfillmentRegionNameAr: string | null;
  fulfillmentRegionNameEn: string | null;
  /** Decimal string at scale 2. A percentage, not money. */
  taxRatePercent: string | null;
  /** Decimal strings. Null until first published. */
  unitPriceExclTaxAmount: MoneyString | null;
  unitTaxAmount: MoneyString | null;
  totalValueInclTaxAmount: MoneyString | null;
  /**
   * The share a single trader buys, as a percentage of the target, and the
   * quantity that resolves to. Derived from the pinned policy; the basis
   * points and the policy version id are never exposed.
   */
  sharePercentage: number | null;
  shareQuantity: number | null;
  /** ISO 8601, all nullable — each marks a lifecycle event that may not have happened. */
  firstActivatedAt: string | null;
  pausedAt: string | null;
  blockedAt: string | null;
  updatedAt: string;
}

export const SUPPLIER_OPPORTUNITY_DETAIL_KEYS = [
  ...SUPPLIER_OPPORTUNITY_SUMMARY_KEYS,
  "descriptionAr",
  "descriptionEn",
  "expectedPreparationDays",
  "fulfillmentLocationId",
  "fulfillmentCityNameAr",
  "fulfillmentCityNameEn",
  "fulfillmentRegionNameAr",
  "fulfillmentRegionNameEn",
  "taxRatePercent",
  "unitPriceExclTaxAmount",
  "unitTaxAmount",
  "totalValueInclTaxAmount",
  "sharePercentage",
  "shareQuantity",
  "firstActivatedAt",
  "pausedAt",
  "blockedAt",
  "updatedAt",
] as const satisfies readonly (keyof SupplierOpportunityDetail)[];

/**
 * The actions the API will accept, per status.
 *
 * Transcribed from `opportunities.service.ts`, not designed here:
 *
 *   update — `EDITABLE_STATUSES` = DRAFT, SCHEDULED, ACTION_REQUIRED.
 *   publish — DRAFT or ACTION_REQUIRED only.
 *   extend — ACTIVE only, and additionally requires `extendedAt === null`
 *            and `endAt` still in the future. Those two are row facts, not
 *            status facts, so they are checked separately by the caller.
 *   delete — DRAFT only.
 */
export const SUPPLIER_OPPORTUNITY_EDITABLE_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTION_REQUIRED",
] as const satisfies readonly SupplierOpportunityStatus[];

export const SUPPLIER_OPPORTUNITY_PUBLISHABLE_STATUSES = [
  "DRAFT",
  "ACTION_REQUIRED",
] as const satisfies readonly SupplierOpportunityStatus[];

export const SUPPLIER_OPPORTUNITY_DELETABLE_STATUSES = [
  "DRAFT",
] as const satisfies readonly SupplierOpportunityStatus[];

export const SUPPLIER_OPPORTUNITY_EXTENDABLE_STATUSES = [
  "ACTIVE",
] as const satisfies readonly SupplierOpportunityStatus[];
