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

import type { SaleMode } from "./enums";

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
 * COMMERCIAL TERMS ARE PUBLIC, BY DECISION. Price, the three quantities
 * and progress are shown to a visitor deliberately, to let them judge an
 * offer before creating an account. This reverses the original
 * boundary, which withheld all of it until sign-in.
 *
 * What that decision does NOT extend to, and what must stay off this
 * shape: anything about the supplier or the buyers, margins, commission,
 * `expectedPreparationDays`, `sharePercentage`, and every internal
 * identifier other than the opportunity's own id. Seeing what is for
 * sale is not the same as seeing how the platform is run.
 *
 * Buying still requires an authenticated trader. Nothing here is a
 * purchase step, and none of it is a promise of availability — see
 * `unsoldQuantity` below.
 */
export interface PublicOpportunityItem {
  id: string;
  /**
   * WHICH OF THE TWO SALES PATHS THIS LISTING IS — the first thing a
   * card must read.
   *
   * `GROUP` shows a target, a progress bar, a share size and a
   * countdown. `DIRECT` shows a price, what is left on the shelf, and a
   * quantity the buyer chooses. Three fields below are meaningless in
   * one of the two and are null there: `endAt` and `shareQuantity` for
   * DIRECT, which has no window and no share.
   */
  saleMode: SaleMode;
  productNameAr: string;
  productNameEn: string;
  /** Null for legacy snapshots that predate media capture, and for products with no image. */
  imageUrl: string | null;
  thumbnailUrl: string | null;
  fulfillmentCityNameAr: string;
  fulfillmentCityNameEn: string;
  /**
   * The REGION is what a card shows a visitor — a city is too fine a
   * grain to judge an offer by, and the reference design names the
   * region. Nullable for the same reason as on the detail: the region
   * columns are genuinely optional on a published opportunity.
   */
  fulfillmentRegionNameAr: string | null;
  fulfillmentRegionNameEn: string | null;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  /** Tax-INCLUSIVE unit price. A decimal string, never a float. */
  unitPriceInclTaxAmount: string;
  currency: string;
  targetQuantity: number;
  /**
   * `targetQuantity − fundedQuantity`. An arithmetic difference, NOT a
   * guarantee of what can still be bought: what a later cancellation or
   * refund does to sellable quantity is an explicitly deferred
   * decision. UI copy must not present it as guaranteed availability.
   */
  unsoldQuantity: number;
  /**
   * Share of the SUPPLY CAP sold so far. Not funding, not a collective
   * goal, and reaching it unlocks nothing — every paid order is
   * fulfilled independently.
   */
  progressPercentage: number;
  /**
   * Minimum purchase AND the increment step — one value serves both.
   *
   * NULL FOR A DIRECT LISTING: the buyer names any quantity up to what
   * is left, so there is neither a minimum nor a step.
   */
  shareQuantity: number | null;
  /**
   * ISO 8601. The window close, so a visitor can judge urgency.
   *
   * NULL FOR A DIRECT LISTING, which has no window — a shelf does not
   * expire. A countdown must check `saleMode` before it renders.
   */
  endAt: string | null;
  /** ACTIVE, or SCHEDULED when an admin has enabled public preview of scheduled opportunities. */
  status: PublicOpportunityStatus;
}

export const PUBLIC_OPPORTUNITY_ITEM_KEYS = [
  "id",
  "saleMode",
  "productNameAr",
  "productNameEn",
  "imageUrl",
  "thumbnailUrl",
  "fulfillmentCityNameAr",
  "fulfillmentCityNameEn",
  "fulfillmentRegionNameAr",
  "fulfillmentRegionNameEn",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "unitPriceInclTaxAmount",
  "currency",
  "targetQuantity",
  "unsoldQuantity",
  "progressPercentage",
  "shareQuantity",
  "endAt",
  "status",
] as const satisfies readonly (keyof PublicOpportunityItem)[];

/**
 * The fields the public shapes may NEVER carry, whatever else changes.
 *
 * Kept beside the shapes rather than inside a test, so widening the
 * public view means editing this list on purpose — and so the same list
 * can be asserted from more than one place.
 */
export const PUBLIC_OPPORTUNITY_FORBIDDEN_FIELDS = [
  // How the platform earns and pays, and how fast a supplier works.
  "expectedPreparationDays",
  "sharePercentage",
  "commissionAmount",
  "commissionTaxAmount",
  "supplierPayableAmount",
  "unitPriceExclTaxAmount",
  "unitTaxAmount",
  "taxRatePercent",
  // Who is behind the offer, and who has bought.
  "supplierCompanyId",
  "supplierCompanyName",
  "traderCompanyId",
  "fulfillmentLocationId",
  // Internal identifiers and machinery.
  "productId",
  "taxSnapshotId",
  "commissionPolicyVersionId",
  "reasonCode",
] as const;

/**
 * Public detail.
 *
 * Adds the product description and the window open. The region and the
 * commercial terms now live on the list item, because the card shows
 * them too — the detail stays a strict superset rather than keeping a
 * second copy of the same fields.
 *
 * Still carries no `expectedPreparationDays`, no commission, no margin
 * and nothing identifying the supplier.
 */
export interface PublicOpportunityDetail extends PublicOpportunityItem {
  productDescriptionAr: string | null;
  productDescriptionEn: string | null;
  /** ISO 8601. The window open — for a SCHEDULED opportunity, when it starts. */
  startAt: string;

  /**
   * WHAT THE PRODUCT IS, physically — «مواصفات العبوة».
   *
   * ALL OF THESE WERE ALREADY FROZEN IN THE SNAPSHOT and none reached a
   * client: `parseSnapshot` read four of its fourteen keys. Widening the
   * read needs no migration and no new column — the values have been
   * stored at approval time since the snapshot builder was written.
   *
   * PUBLIC, NOT TRADER-ONLY. These are facts about the THING, not about
   * the deal: a weight and a box size say nothing about margin, about
   * who is selling, or about how fast they work. Every commercial field
   * stays where it was, and `PUBLIC_OPPORTUNITY_FORBIDDEN_FIELDS` is
   * untouched — nothing named there is added here.
   *
   * DECIMALS AS STRINGS, like every other decimal on this boundary. A
   * weight of 12.5 kg through IEEE-754 is a different number on the way
   * back.
   */
  /** The catalogue node the product was approved under. A name is resolved client-side. */
  taxonomyNodeId: string | null;
  weightPerUnit: string | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  packageContentQuantity: string | null;
  packageContentUnitNameAr: string | null;
  packageContentUnitNameEn: string | null;
  /**
   * EVERY photograph, in the snapshot's own order (main first).
   *
   * The list route stays on `imageUrl`/`thumbnailUrl` — one picture is
   * all a card shows. This is the detail's gallery, and it is the same
   * route with an index rather than a second endpoint.
   */
  imageUrls: readonly string[];
  thumbnailUrls: readonly string[];
}

export const PUBLIC_OPPORTUNITY_DETAIL_KEYS = [
  ...PUBLIC_OPPORTUNITY_ITEM_KEYS,
  "productDescriptionAr",
  "productDescriptionEn",
  "startAt",
  "taxonomyNodeId",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
  "imageUrls",
  "thumbnailUrls",
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
  /**
   * WHAT CAN ACTUALLY BE BOUGHT RIGHT NOW:
   * `targetQuantity − fundedQuantity − every live lock`.
   *
   * `unsoldQuantity` above is the arithmetic difference and ignores
   * other buyers holding stock in open baskets and unfinished payments.
   * This one counts them, which is what a quantity picker needs: a
   * ceiling the checkout will actually honour rather than one it will
   * refuse with «the requested quantity is no longer available».
   *
   * STILL A GUIDE, NOT A PROMISE. It is true at the instant it was
   * read; the checkout recomputes it under the offer row lock, and that
   * computation is the only one that decides.
   *
   * ZERO ON A DIRECT LISTING IS «نفد المخزون» — sold out, still ACTIVE,
   * and buyable again the moment the supplier restocks.
   */
  availableQuantity: number;
  /**
   * Minimum purchase AND the increment step — a single value serves
   * both. NULL for a direct sale, which has neither.
   */
  shareQuantity: number | null;
  /** Human percentage (e.g. 10, 2.5) — never raw basis points. NULL for a direct sale. */
  sharePercentage: number | null;
}

/**
 * `TraderOpportunityTerms` field names, for a boundary test that
 * asserts none of them reaches a public shape.
 */
export const TRADER_OPPORTUNITY_TERMS_KEYS = [
  "unitPriceInclTaxAmount",
  "currency",
  "targetQuantity",
  "fundedQuantity",
  "unsoldQuantity",
  "progressPercentage",
  "availableQuantity",
  "shareQuantity",
  "sharePercentage",
] as const satisfies readonly (keyof TraderOpportunityTerms)[];

/**
 * The list item a signed-in trader sees.
 *
 * COMPOSED, not restated: it extends `PublicOpportunityItem` and adds
 * `TraderOpportunityTerms`. Writing the presentation fields out again
 * is how the two lists drift — a field added to the public card and
 * forgotten here, or a name that differs by a letter, which no
 * compiler catches because the two would be unrelated types.
 *
 * The inheritance is one-directional on purpose. Terms extend the
 * public shape; the public shape never extends terms, so a commercial
 * field cannot arrive on the anonymous marketplace by inheritance.
 */
export interface TraderOpportunityItem
  extends PublicOpportunityItem,
    TraderOpportunityTerms {}

export const TRADER_OPPORTUNITY_ITEM_KEYS = [
  ...PUBLIC_OPPORTUNITY_ITEM_KEYS,
  ...TRADER_OPPORTUNITY_TERMS_KEYS,
] as const satisfies readonly (keyof TraderOpportunityItem)[];

/**
 * The detail a signed-in trader sees.
 *
 * `PublicOpportunityDetail` already adds the safe non-commercial
 * context — the product description, the fulfilment region, the window
 * open — so this composes that with the same terms rather than
 * introducing a second description field that could disagree.
 *
 * `expectedPreparationDays` is added HERE and not on the item. It is
 * how long the supplier has to prepare after payment, which a trader
 * needs before buying and which is absent from every public shape: it
 * describes the supplier's commitment, not the product.
 */
export interface TraderOpportunityDetail
  extends PublicOpportunityDetail,
    TraderOpportunityTerms {
  /** Days the supplier has to prepare, from the frozen opportunity. */
  expectedPreparationDays: number;
}

export const TRADER_OPPORTUNITY_DETAIL_KEYS = [
  ...PUBLIC_OPPORTUNITY_DETAIL_KEYS,
  ...TRADER_OPPORTUNITY_TERMS_KEYS,
  "expectedPreparationDays",
] as const satisfies readonly (keyof TraderOpportunityDetail)[];

/**
 * Everything a trader shape may carry that a public one may not.
 *
 * Exists so the boundary can be asserted in one place: a test walks a
 * public payload and fails if any of these appears. Adding a field to
 * `TraderOpportunityTerms` without adding it here fails the
 * `satisfies` above, so the list cannot fall behind.
 */
export const COMMERCIAL_ONLY_KEYS = [
  ...TRADER_OPPORTUNITY_TERMS_KEYS,
  "expectedPreparationDays",
] as const;
