import { SUPPLIER_OPPORTUNITY_REASON_CODES } from "./supplier-opportunity";
import type { SupplierOpportunityReasonCode } from "./supplier-opportunity";

/**
 * WHO CAN ACTUALLY CLEAR A BLOCKED LISTING.
 *
 * A listing that cannot go live sits in ACTION_REQUIRED with one of ten
 * reason codes. The codes look alike and are not alike at all: some
 * describe something the SUPPLIER switched off and can switch back on,
 * some describe a decision the PLATFORM already took and is not waiting
 * on, and two describe platform configuration that nobody outside this
 * console can touch.
 *
 * Reading the enum name alone gets this wrong. `PRODUCT_SUSPENDED`
 * sounds like work; it is the record of work already done by the person
 * who would be reminded of it. `LOCATION_INACTIVE` sounds like the
 * platform; it is a supplier switching off their own branch.
 *
 * ONE QUEUE PER CASE. Two reasons are genuinely the platform's and yet
 * are absent from `PLATFORM_OWNED` — an unverified supplier and one who
 * is not financially ready. Both are already counted where they are
 * decided (SUPPLIER_VERIFICATION and BANK_ACCOUNT_REVIEW), and counting
 * them again here would put one piece of work in two queues and let an
 * operator clear it in one while it still stands in the other.
 */

/**
 * Cleared only from inside this console, and counted nowhere else.
 *
 * A region or a city switched off in reference data, and a tax rate
 * that was never configured. In all three, every listing on the
 * platform that depends on it is off the market and the supplier cannot
 * do a thing about it.
 *
 * THE REGION IS THE ONE THAT BITES NOW. It is what a branch is recorded
 * against, so switching one off takes every listing shipping from it
 * off the market at once — which is exactly why the operator who did it
 * has to see the count. The city entry stays for the listings blocked
 * under the old rule, and for a branch that still names a city.
 */
export const PLATFORM_OWNED_LISTING_BLOCKERS = [
  "LOCATION_REGION_INACTIVE",
  "LOCATION_CITY_INACTIVE",
  "TAX_RATE_NOT_CONFIGURED",
] as const satisfies readonly SupplierOpportunityReasonCode[];

/**
 * The platform's own decision, already taken.
 *
 * Suspending or closing a product blocks its listings by design. Showing
 * that back to the administrator who did it as a task is how a queue
 * fills with its own history.
 */
export const ADMIN_DECIDED_LISTING_BLOCKERS = [
  "PRODUCT_SUSPENDED",
  "PRODUCT_CLOSED",
] as const satisfies readonly SupplierOpportunityReasonCode[];

/**
 * Already counted in a queue of its own.
 *
 * Kept as a named list rather than left implicit, so that the reason a
 * platform-owned blocker is absent from `PLATFORM_OWNED` is written
 * down where the next reader will look for it.
 */
export const ELSEWHERE_QUEUED_LISTING_BLOCKERS = [
  "SUPPLIER_NOT_VERIFIED",
  "SUPPLIER_NOT_FINANCIALLY_READY",
] as const satisfies readonly SupplierOpportunityReasonCode[];

/** The supplier switched it off and the supplier can switch it back on. */
export const SUPPLIER_OWNED_LISTING_BLOCKERS = [
  "PRODUCT_ARCHIVED",
  "LOCATION_INACTIVE",
  "PURCHASE_QUANTITY_NOT_COMPATIBLE",
  /**
   * A product that is neither approved, suspended, closed nor archived.
   *
   * UNREACHABLE TODAY and kept anyway. Publishing sets a product to
   * APPROVED and the approval queue is gone, so no product reaches the
   * evaluator in DRAFT, PENDING_REVIEW or REJECTED — the branch that
   * produces this code cannot fire. It stays classified because a
   * defensive branch in an eligibility evaluator is not dead weight, and
   * because a code with no owner is how one ends up in the wrong queue
   * if it ever fires again.
   */
  "PRODUCT_NOT_APPROVED",
] as const satisfies readonly SupplierOpportunityReasonCode[];

/**
 * Every reason code is classified exactly once.
 *
 * Asserted by a test rather than trusted: a code added to the evaluator
 * and forgotten here would silently fall out of every queue, which is
 * the failure this file exists to prevent.
 */
export const CLASSIFIED_LISTING_BLOCKERS = [
  ...PLATFORM_OWNED_LISTING_BLOCKERS,
  ...ADMIN_DECIDED_LISTING_BLOCKERS,
  ...ELSEWHERE_QUEUED_LISTING_BLOCKERS,
  ...SUPPLIER_OWNED_LISTING_BLOCKERS,
] as const;

/** True when clearing this blocker is work for the platform, uncounted elsewhere. */
export function isPlatformOwnedListingBlocker(
  code: string | null,
): code is (typeof PLATFORM_OWNED_LISTING_BLOCKERS)[number] {
  return (
    code !== null &&
    (PLATFORM_OWNED_LISTING_BLOCKERS as readonly string[]).includes(code)
  );
}

/** The full vocabulary, re-exported so a caller needs one import. */
export const ALL_LISTING_BLOCKERS = SUPPLIER_OPPORTUNITY_REASON_CODES;
