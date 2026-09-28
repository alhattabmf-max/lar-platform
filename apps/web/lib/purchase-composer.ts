import type { CheckoutAllocationIntent } from "./checkout-create";

/**
 * The rules for composing a purchase, as a pure function.
 *
 * Separated from the form so they can be exercised directly: these are
 * the constraints the server enforces, and a UI that disagrees with
 * them either blocks a valid purchase or lets an invalid one through to
 * a 400 the person cannot act on.
 *
 * Two principles run through all of it.
 *
 * NOTHING IS CORRECTED SILENTLY. A quantity of 5001 against a step of
 * 5000 is reported, not rounded to 5000 or 10000. Either would change
 * what the person asked to buy, and they would find out at the payment
 * screen. The one exception is stated where it happens: a single
 * location has its quantity filled in from the total, because there is
 * only one possible split and making someone type it twice is a step
 * with no decision in it.
 *
 * NOTHING HERE IS AUTHORITATIVE. Passing this validation does not mean
 * the quantity is available — `unsoldQuantity` is `target − funded`,
 * an arithmetic difference computed when the page rendered, and the
 * only authority on availability is the lock the server takes during
 * checkout. Validating against it catches the obvious mistake early;
 * it does not promise the purchase will succeed.
 */

/**
 * A trader's own branch, as this form needs it.
 *
 * The list comes from `/companies/me/locations`, which is scoped to the
 * caller's company and returns only active locations — so the list IS
 * the eligibility rule. Nothing here re-derives it, and no id may be
 * typed in: a location that is not in this list cannot be selected and
 * is rejected before submit.
 *
 * Coordinates are absent by construction. The name, city and short
 * address are what identify a branch to the person choosing it.
 */
export interface SelectableLocation {
  id: string;
  name: string;
  /**
   * WHERE THE BRANCH IS, already localised. Null only when the
   * reference data could not be read — a branch always has a region.
   */
  regionName: string | null;
  /**
   * The optional refinement, already localised. Null when the branch
   * names no city, which is an ordinary state.
   */
  cityName: string | null;
  shortAddress: string;
}

/** One row of the composer. `quantity` is null while the field is empty. */
export interface AllocationDraft {
  companyLocationId: string;
  quantity: number | null;
}

/**
 * What can be wrong, as a closed list.
 *
 * Each maps to one message key and one field to focus. A free-text
 * message would drift from the translations and could not be tested.
 */
export const PURCHASE_ISSUES = [
  "QUANTITY_REQUIRED",
  "QUANTITY_NOT_INTEGER",
  "QUANTITY_NOT_POSITIVE",
  "QUANTITY_NOT_MULTIPLE",
  "QUANTITY_ABOVE_UNSOLD",
  "ALLOCATION_REQUIRED",
  "ALLOCATION_NOT_INTEGER",
  "ALLOCATION_NOT_POSITIVE",
  "ALLOCATION_DUPLICATE",
  "ALLOCATION_UNKNOWN_LOCATION",
  "ALLOCATION_SUM_MISMATCH",
] as const;

export type PurchaseIssueCode = (typeof PURCHASE_ISSUES)[number];

export interface PurchaseIssue {
  code: PurchaseIssueCode;
  /**
   * Which control to focus and describe.
   *
   * `"quantity"`, or the index of the allocation row. Focus must land
   * on the thing that is wrong; a form that announces an error and
   * leaves the cursor where it was makes someone hunt for it.
   */
  field: "quantity" | { allocationIndex: number };
  /** Interpolation values for the message, e.g. the required step. */
  values?: Record<string, number>;
}

export interface PurchaseInput {
  quantity: number | null;
  allocations: AllocationDraft[];
  /** The purchase step AND the minimum. One value serves both. */
  shareQuantity: number;
  /** `target − funded`. An early check, never a guarantee. */
  unsoldQuantity: number;
  /** The ids that may be selected. Anything else is rejected. */
  selectableIds: readonly string[];
}

/** A whole number, safely representable. Quantities are counts, never decimals. */
function isWholeNumber(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value);
}

/**
 * Every problem with the draft, in the order they should be read.
 *
 * ALL of them, not just the first: a form that reveals one error at a
 * time turns a two-field mistake into two round trips. The caller
 * focuses the first and describes the rest in place.
 */
export function validatePurchase(input: PurchaseInput): PurchaseIssue[] {
  const issues: PurchaseIssue[] = [];
  const { quantity, allocations, shareQuantity, unsoldQuantity, selectableIds } = input;

  // ---- quantity ----------------------------------------------------
  if (quantity === null) {
    issues.push({ code: "QUANTITY_REQUIRED", field: "quantity" });
  } else if (!isWholeNumber(quantity)) {
    // A fractional quantity is not a smaller purchase, it is a
    // nonsensical one — you cannot buy 2.5 cartons.
    issues.push({ code: "QUANTITY_NOT_INTEGER", field: "quantity" });
  } else if (quantity <= 0) {
    issues.push({ code: "QUANTITY_NOT_POSITIVE", field: "quantity" });
  } else {
    if (shareQuantity > 0 && quantity % shareQuantity !== 0) {
      // 5001 against a step of 5000 is reported, never rounded. Rounding
      // either way changes what was asked for.
      issues.push({
        code: "QUANTITY_NOT_MULTIPLE",
        field: "quantity",
        values: { step: shareQuantity },
      });
    }
    if (quantity > unsoldQuantity) {
      issues.push({
        code: "QUANTITY_ABOVE_UNSOLD",
        field: "quantity",
        values: { unsold: unsoldQuantity },
      });
    }
  }

  // ---- allocations -------------------------------------------------
  if (allocations.length === 0) {
    issues.push({ code: "ALLOCATION_REQUIRED", field: { allocationIndex: 0 } });
  }

  const seen = new Set<string>();
  let sum = 0;
  let everyRowUsable = allocations.length > 0;

  allocations.forEach((allocation, index) => {
    const field = { allocationIndex: index } as const;

    if (!selectableIds.includes(allocation.companyLocationId)) {
      // Not in the list the API returned for THIS company. Unreachable
      // through the UI, which offers no free-text id — asserted anyway,
      // because "unreachable" is a property of today's markup.
      issues.push({ code: "ALLOCATION_UNKNOWN_LOCATION", field });
      everyRowUsable = false;
    } else if (seen.has(allocation.companyLocationId)) {
      // Two rows for one branch is ambiguous, not additive: the server
      // would have to guess whether it is 4+4 or a mistake.
      issues.push({ code: "ALLOCATION_DUPLICATE", field });
      everyRowUsable = false;
    } else {
      seen.add(allocation.companyLocationId);
    }

    if (allocation.quantity === null) {
      issues.push({ code: "ALLOCATION_REQUIRED", field });
      everyRowUsable = false;
    } else if (!isWholeNumber(allocation.quantity)) {
      issues.push({ code: "ALLOCATION_NOT_INTEGER", field });
      everyRowUsable = false;
    } else if (allocation.quantity <= 0) {
      // A zero row is not a smaller delivery, it is a branch that should
      // not be on the order at all.
      issues.push({ code: "ALLOCATION_NOT_POSITIVE", field });
      everyRowUsable = false;
    } else {
      sum += allocation.quantity;
    }
  });

  // The sum is only meaningful once every row is a real number, and
  // once the total itself is. Reporting a mismatch on top of "this
  // field is empty" describes the same mistake twice.
  if (everyRowUsable && isWholeNumber(quantity) && quantity > 0 && sum !== quantity) {
    issues.push({
      code: "ALLOCATION_SUM_MISMATCH",
      field: { allocationIndex: 0 },
      values: { allocated: sum, quantity },
    });
  }

  return issues;
}

/**
 * The draft as the API's allocation list.
 *
 * Only ever called on a validated draft, so the nulls are gone — but it
 * filters rather than asserts, because a mapper that throws inside a
 * submit handler fails in a way nobody can act on.
 */
export function toAllocationIntents(
  allocations: readonly AllocationDraft[]
): CheckoutAllocationIntent[] {
  return allocations
    .filter((a): a is { companyLocationId: string; quantity: number } => a.quantity !== null)
    .map((a) => ({ companyLocationId: a.companyLocationId, quantity: a.quantity }));
}

/**
 * The next quantity when the step buttons are pressed.
 *
 * Always lands on a multiple of the step, and never below one step —
 * the minimum and the increment are the same value. A partial current
 * value snaps to the nearest valid one in the direction pressed, which
 * is the one place where adjusting the number is right: the person is
 * asking for "more" or "less", not for a specific figure.
 */
export function stepQuantity(
  current: number | null,
  shareQuantity: number,
  direction: 1 | -1
): number {
  const step = shareQuantity > 0 ? shareQuantity : 1;
  if (current === null || !Number.isFinite(current)) return step;

  const steps = current / step;
  const next = direction === 1 ? Math.floor(steps) + 1 : Math.ceil(steps) - 1;

  return Math.max(1, next) * step;
}
