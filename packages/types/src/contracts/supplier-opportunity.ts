import type { MoneyString } from "./money";
import type { SaleMode } from "./enums";

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
  // KEPT though it is no longer raised for a branch that names no
  // city: listings blocked before the region became the operational
  // unit still carry it, and a client that cannot translate it would
  // show a supplier a raw code. Still raised when a branch DOES name
  // a city and that city is switched off.
  "LOCATION_CITY_INACTIVE",
  "LOCATION_REGION_INACTIVE",
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
  /**
   * The supplier's own photograph of this product, or null.
   *
   * A ROUTE THE SUPPLIER CAN ALREADY REACH —
   * `/companies/me/products/:productId/media/:mediaId/image` — and not
   * the public one. The public route serves ACTIVE offers only, so a
   * draft, a paused offer or one that has expired would answer 404 for
   * its own owner while its picture sat in storage. This screen lists
   * every status, so it needs the route that is scoped to the company
   * rather than to what a visitor may see.
   *
   * Null when the product has no media at all. No placeholder is
   * invented here; what a missing picture looks like is the screen's
   * business.
   */
  imageUrl: string | null;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  /**
   * WHICH OF THE TWO SALES PATHS THIS LISTING IS.
   *
   * `GROUP` is the collective offer: a target to reach, a share each
   * buyer takes, a window it runs for. `DIRECT` is a fixed-price sale
   * from stock — the buyer names the quantity, the order goes to
   * preparation the moment it is paid, and there is no target, no share
   * and no window.
   *
   * THE SCREEN READS THIS BEFORE ANYTHING ELSE about the row: it decides
   * whether the numbers mean progress toward a goal or what is left on a
   * shelf, and whether `endAt`, `shareQuantity` and
   * `decisionWindowClosesAt` mean anything at all.
   */
  saleMode: SaleMode;
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
  /**
   * When the sales window closes — NULL for a direct sale, which has
   * none. A screen that shows a countdown must check `saleMode` first.
   */
  endAt: string | null;
  /** Non-null once extended. A GROUP offer may be extended exactly once. */
  extendedAt: string | null;
  /**
   * WHEN THE SUPPLIER'S 24 HOURS RUN OUT, on an offer whose window
   * closed without filling.
   *
   * «فرصة لم تصل هدفها مئة بالمئة بل وصلت ستين بالمئة… هنا مهلة تعطى
   *  للمورد مدة 24 ساعة» — and «يقرر المورد في العرض نفسه», so the
   * screen that shows the offer is the screen that must show the clock.
   *
   * NULL means the window has not opened, or has been resolved — never
   * "it is running", which is the only state either decision accepts.
   */
  decisionWindowClosesAt: string | null;
  createdAt: string;
}

export const SUPPLIER_OPPORTUNITY_SUMMARY_KEYS = [
  "id",
  "productId",
  "productNameAr",
  "productNameEn",
  "imageUrl",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "saleMode",
  "status",
  "reasonCode",
  "targetQuantity",
  "fundedQuantity",
  "unitPriceAmount",
  "currency",
  "startAt",
  "endAt",
  "extendedAt",
  "decisionWindowClosesAt",
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
 *   delete — EVERY state. `DELETE /companies/me/listings/:id` decides
 *            between removing the rows and archiving them by looking at
 *            what the listing carries, not at what state it is in: a
 *            listing nobody bought goes, one with a checkout, an order
 *            or a sold unit is archived so the records pointing at it
 *            keep naming something real. It refuses only while a buyer
 *            holds a live lock, which is a person mid-purchase rather
 *            than a state.
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

/**
 * EVERY STATE, because removing is no longer the same act everywhere.
 *
 * It used to be DRAFT only, and that was right when delete meant erase:
 * a listing with a sold unit cannot be erased without leaving invoices,
 * disputes and settlements pointing at nothing. The route now archives
 * exactly those and erases only what nobody ever touched — so the
 * question "may I remove this?" has one answer, and the question "what
 * happens when I do?" is answered by the data rather than by a status.
 */
export const SUPPLIER_OPPORTUNITY_DELETABLE_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTION_REQUIRED",
  "ACTIVE",
  "PAUSED",
  "FUNDED",
  "EXPIRED",
  "CANCELLED",
] as const satisfies readonly SupplierOpportunityStatus[];

export const SUPPLIER_OPPORTUNITY_EXTENDABLE_STATUSES = [
  "ACTIVE",
] as const satisfies readonly SupplierOpportunityStatus[];

/**
 * The states in which an offer still stands between its product and a
 * second one.
 *
 * The owner's rule: «لا يُنشر عرض ثانٍ على المنتج إلا بعد انتهاء العرض
 * الأول». Two live offers on one product compete for the same stock and
 * can between them sell more than the supplier holds.
 *
 * SCHEDULED counts: it is committed and will open on its own. PAUSED
 * counts: the platform stopped it and may start it again. FUNDED
 * counts: its orders are still being fulfilled. DRAFT and
 * ACTION_REQUIRED do NOT — neither has ever been buyable, which is why
 * a supplier may keep the next offer ready as a draft while the current
 * one runs. EXPIRED and CANCELLED are the two that genuinely ended.
 *
 * DECLARED HERE, in the one place both sides read. The API refuses a
 * second publication on this list and the portal hides the button on
 * the same list; two copies of it would eventually disagree, and the
 * disagreement would show up as a button that leads to a refusal.
 */
export const SUPPLIER_OPPORTUNITY_LIVE_STATUSES = [
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "FUNDED",
] as const satisfies readonly SupplierOpportunityStatus[];

/**
 * The reason a publication was refused, read out of an error envelope.
 *
 * SAME DISCIPLINE AS `readFailedChecks`, and for the same reason:
 * `details` can carry internal paths, so nothing general is exposed.
 * This returns a value ONLY when the code is `VALIDATION_FAILED`, the
 * payload names `blockedReason`, and that value is in the closed
 * `SUPPLIER_OPPORTUNITY_REASON_CODES` vocabulary. Anything else leaves
 * the caller with the generic message.
 *
 * WHAT IT IS FOR: a supplier whose company has no tax profile pressed
 * «نشر المنتج» and was told "VALIDATION_FAILED", which named nothing
 * they could act on. The platform already translates a fixing sentence
 * for every one of these codes — `supplier.opportunities.reasonFix.*` —
 * and this is what lets the form reach it.
 */
export function readBlockedReason(body: unknown): SupplierOpportunityReasonCode | null {
  if (typeof body !== "object" || body === null) return null;

  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;

  const { code, details } = error as { code?: unknown; details?: unknown };
  if (code !== "VALIDATION_FAILED") return null;

  if (typeof details !== "object" || details === null) return null;
  const reason = (details as { blockedReason?: unknown }).blockedReason;

  if (typeof reason !== "string") return null;
  return (SUPPLIER_OPPORTUNITY_REASON_CODES as readonly string[]).includes(reason)
    ? (reason as SupplierOpportunityReasonCode)
    : null;
}

/**
 * The listing that was saved but not published, from the same envelope.
 *
 * Without it the form can say what is wrong and not where the work
 * went, which is the half that made a supplier press the button again.
 */
export function readBlockedListingId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;

  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;

  const { code, details } = error as { code?: unknown; details?: unknown };
  if (code !== "VALIDATION_FAILED") return null;

  if (typeof details !== "object" || details === null) return null;
  const id = (details as { listingId?: unknown }).listingId;

  return typeof id === "string" && id.length > 0 ? id : null;
}
