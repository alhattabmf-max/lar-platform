/**
 * Opportunity contracts.
 *
 * The public/trader split below is deliberate and load-bearing:
 * commercial terms — price, quantities, share size, purchase step —
 * stay behind RequireTraderGuard. The anonymous view carries only what
 * is needed to decide whether to sign in.
 *
 * Every field is sourced from a real stored or derived value; see
 * docs/PHASE_8_IMPLEMENTATION_PLAN.md. Nothing here is invented.
 */

export const OPPORTUNITY_IMAGE_VARIANTS = ["main", "thumb"] as const;
export type OpportunityImageVariant = (typeof OPPORTUNITY_IMAGE_VARIANTS)[number];

/**
 * The only statuses an anonymous visitor can ever observe.
 *
 * ACTIVE always; SCHEDULED only while an administrator has enabled
 * `showScheduledPubliclyEnabled`. Every other status (DRAFT, CANCELLED,
 * ENDED, …) is filtered out server-side and has no public
 * representation — which is why this is a closed list of two rather
 * than a re-export of the Prisma enum.
 */
export const PUBLIC_OPPORTUNITY_STATUSES = ["ACTIVE", "SCHEDULED"] as const;
export type PublicOpportunityStatus = (typeof PUBLIC_OPPORTUNITY_STATUSES)[number];

/**
 * Closed sort vocabulary for both the public and the trader list.
 *
 * NEWEST is the API default, which keeps every caller written before
 * this parameter existed on its original ordering. A surface may choose
 * a different default for itself; that is a presentation decision and
 * does not change the wire default.
 *
 * Each option resolves to a FULLY deterministic ordering server-side —
 * every one ends in `id` — because a paginated list ordered by a
 * non-unique column alone can repeat or drop rows between pages.
 */
export const OPPORTUNITY_SORTS = ["NEWEST", "ENDING_SOON"] as const;
export type OpportunitySort = (typeof OPPORTUNITY_SORTS)[number];

/** The API default. Not necessarily what a given screen chooses to send. */
export const DEFAULT_OPPORTUNITY_SORT: OpportunitySort = "NEWEST";

/**
 * Anonymous view.
 *
 * `salesUnitName*` is included because a selling unit ("carton",
 * "pallet") describes the product, not its commercial terms — it
 * reveals no price, quantity, or margin.
 *
 * There is deliberately NO price, NO quantity, NO share size and NO
 * purchase step. Adding one here moves the public/authenticated
 * boundary and must be a conscious decision, not a convenience.
 */
export interface PublicOpportunityItem {
  id: string;
  productNameAr: string;
  productNameEn: string;
  /** Null for legacy snapshots that predate media capture, and for products with no image. */
  imageUrl: string | null;
  thumbnailUrl: string | null;
  fulfillmentCityNameAr: string;
  fulfillmentCityNameEn: string;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  /** ISO 8601. The window close, so a visitor can judge urgency without seeing terms. */
  endAt: string;
  /** ACTIVE, or SCHEDULED when an admin has enabled public preview of scheduled opportunities. */
  status: PublicOpportunityStatus;
}

export const PUBLIC_OPPORTUNITY_ITEM_KEYS = [
  "id",
  "productNameAr",
  "productNameEn",
  "imageUrl",
  "thumbnailUrl",
  "fulfillmentCityNameAr",
  "fulfillmentCityNameEn",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "endAt",
  "status",
] as const satisfies readonly (keyof PublicOpportunityItem)[];

/**
 * Public detail.
 *
 * Adds the product description, the fulfilment REGION and the window
 * open — descriptive context, no commercial terms. In particular it
 * still carries no price, no quantity, no share size, no purchase step
 * and no `expectedPreparationDays`.
 *
 * `fulfillmentRegionName*` is nullable while the city name is not:
 * the region columns are genuinely optional on a published
 * opportunity, whereas a null city violates a publish-time invariant
 * and is raised rather than rendered.
 */
export interface PublicOpportunityDetail extends PublicOpportunityItem {
  productDescriptionAr: string | null;
  productDescriptionEn: string | null;
  fulfillmentRegionNameAr: string | null;
  fulfillmentRegionNameEn: string | null;
  /** ISO 8601. The window open — for a SCHEDULED opportunity, when it starts. */
  startAt: string;
}

export const PUBLIC_OPPORTUNITY_DETAIL_KEYS = [
  ...PUBLIC_OPPORTUNITY_ITEM_KEYS,
  "productDescriptionAr",
  "productDescriptionEn",
  "fulfillmentRegionNameAr",
  "fulfillmentRegionNameEn",
  "startAt",
] as const satisfies readonly (keyof PublicOpportunityDetail)[];

/**
 * Commercial terms, trader-only.
 *
 * `unsoldQuantity` is `targetQuantity − fundedQuantity` — an arithmetic
 * difference, NOT a guarantee of what can be purchased. What a later
 * cancellation or refund does to sellable quantity is an explicitly
 * deferred decision, so this must never be presented as guaranteed
 * availability.
 *
 * `progressPercentage` is the share of the SUPPLY CAP sold so far. It is
 * not funding, not a collective goal, and reaching it unlocks nothing —
 * every paid order is fulfilled independently. UI copy must read
 * "X% of the available quantity has been sold".
 */
export interface TraderOpportunityTerms {
  /** Tax-INCLUSIVE unit price. Serialised as a decimal string to avoid float drift. */
  unitPriceInclTaxAmount: string;
  currency: string;
  targetQuantity: number;
  fundedQuantity: number;
  unsoldQuantity: number;
  progressPercentage: number;
  /** Minimum purchase AND the increment step — a single value serves both. */
  shareQuantity: number;
  /** Human percentage (e.g. 10, 2.5) — never raw basis points. */
  sharePercentage: number;
}
