import type { ProductApprovalStatus } from "@platform/types";

/**
 * Which product actions the API will actually accept, per state.
 *
 * Transcribed from the service's own guards, not invented here:
 *
 *   `submit`  — `products.service.ts` rejects an archived product, then
 *               anything that is not DRAFT or REJECTED. It ALSO requires the
 *               company to be a verified supplier, which is a fact this
 *               module cannot see; that one arrives as a 403 and is shown as
 *               such.
 *
 *   `archive` — rejects an already-archived product and PENDING_REVIEW, and
 *               nothing else. A CLOSED product CAN be archived.
 *
 *   `edit`    — `assertEditableTx` rejects archived, PENDING_REVIEW and
 *               CLOSED. SUSPENDED is editable (the supplier may submit a
 *               correction) but never auto-reactivates. APPROVED is editable
 *               and re-runs the technical checks inside the same
 *               transaction, so an edit that would leave the product
 *               incomplete fails as a whole.
 *
 * Every media mutation goes through that same `assertEditableTx`, so upload,
 * set-main and delete share the `edit` gate exactly.
 *
 * THE SERVER IS THE AUTHORITY. This exists so a button that cannot work is
 * never rendered — it is a courtesy, not the rule. When the two disagree the
 * server wins and its refusal is shown.
 */
export interface ProductActionGate {
  /** POST /companies/me/products/:id/submit */
  canSubmit: boolean;
  /** POST /companies/me/products/:id/archive */
  canArchive: boolean;
  /**
   * PATCH the product, and every media mutation:
   * POST media, POST media/:id/set-main, DELETE media/:id.
   */
  canEditMedia: boolean;
}

export interface ProductGateInput {
  approvalStatus: ProductApprovalStatus;
  /** ISO 8601, or null. Non-null means archived. */
  archivedAt: string | null;
}

export function productActions(product: ProductGateInput): ProductActionGate {
  const archived = product.archivedAt !== null;

  if (archived) {
    // Archived rejects every write the supplier has. Returned as one
    // branch rather than repeated in each rule, so a new action added
    // later cannot forget it.
    return { canSubmit: false, canArchive: false, canEditMedia: false };
  }

  const status = product.approvalStatus;

  return {
    canSubmit: status === "DRAFT" || status === "REJECTED",
    canArchive: status !== "PENDING_REVIEW",
    canEditMedia: status !== "PENDING_REVIEW" && status !== "CLOSED",
  };
}

/**
 * What the supplier should do next, as a message key.
 *
 * Every state resolves to one — a status with no next step leaves someone
 * reading a word and guessing. The keys live under
 * `supplier.products.nextStep.`.
 *
 * `submit` does NOT queue a review: it runs technical checks and, if they
 * pass, approves the product immediately. Copy that promised a review would
 * describe a queue this product does not have.
 */
export function productNextStepKey(product: ProductGateInput): string {
  if (product.archivedAt !== null) return "archived";
  return `status.${product.approvalStatus}`;
}

/**
 * Whether the state is one the supplier has to act on.
 *
 * Drives the needs-attention ordering: DRAFT is unfinished, REJECTED needs a
 * correction, SUSPENDED was pulled and needs one too. An archived product is
 * finished with, whatever its status was.
 */
export function productNeedsAttention(product: ProductGateInput): boolean {
  if (product.archivedAt !== null) return false;
  return (
    product.approvalStatus === "DRAFT" ||
    product.approvalStatus === "REJECTED" ||
    product.approvalStatus === "SUSPENDED"
  );
}
