import type { ReplacementObligationStatus } from "./order";

/**
 * Replacement obligations, from the supplier's side.
 *
 * The trader's `ReplacementSummary`/`ReplacementDetail` are NOT reused, and the
 * reason is more than field selection. They carry the trader's perspective: a
 * replacement is something the trader is OWED, so their contract answers "where
 * is my replacement?" and offers a confirm-delivery action. The supplier's
 * answers "what must I send, and by when?" and offers prepare/ready/ship.
 *
 * Sharing one contract would mean one of the two reading a shape written for
 * the other — the field names would be subtly wrong for whoever lost, and the
 * actions would need a role flag to decide which are valid. A flag is one wrong
 * prop away from offering a supplier the trader's confirmation.
 *
 * These obligations arise from a dispute decision, so the supplier is on the
 * losing side of one. The contract carries the DECISION's existence and the
 * quantity owed. It does not carry the trader's complaint text, the
 * administrator's reasoning, or any evidence — those live on the dispute, which
 * the supplier reads separately and which applies its own boundary.
 */

/** One replacement the supplier owes. */
export interface SupplierReplacementSummary {
  id: string;
  /** The order this arose from, so the UI can link back. */
  orderId: string;
  /** The allocation the original shipment went to. */
  originalOrderAllocationId: string;
  status: ReplacementObligationStatus;
  replacementQuantity: number;
  /** ISO 8601. When the obligation was created by the decision. */
  createdAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  /**
   * True while this needs the supplier to do something.
   *
   * Anything before SHIPPED. Once shipped, the next move is the trader's
   * confirmation; once DELIVERED or FAILED there is no move at all.
   */
  awaitingSupplierAction: boolean;
}

export const SUPPLIER_REPLACEMENT_SUMMARY_KEYS = [
  "id",
  "orderId",
  "originalOrderAllocationId",
  "status",
  "replacementQuantity",
  "createdAt",
  "shippedAt",
  "deliveredAt",
  "failedAt",
  "awaitingSupplierAction",
] as const satisfies readonly (keyof SupplierReplacementSummary)[];

/**
 * The detail adds where it must go, and its own tracking.
 *
 * The destination is read through the ORIGINAL allocation's frozen checkout
 * snapshot — a replacement goes where the original went. Contact name and phone
 * are included for the same reason they are on an order allocation: a carrier
 * cannot deliver to a building without someone to call.
 */
export interface SupplierReplacementDetail extends SupplierReplacementSummary {
  preparationStartedAt: string | null;
  readyToShipAt: string | null;
  /** Null until the supplier ships. Their own carrier and number. */
  carrierCode: string | null;
  trackingNumber: string | null;
  /** The dispute whose decision created this obligation. */
  disputeId: string;
  locationName: string;
  /**
   * Null when the branch named no city.
   *
   * This is a FROZEN SNAPSHOT of what the branch was called when the
   * record was written, and a branch may name a region and no city —
   * so there is nothing to freeze. The region below is never null, so
   * a reader always has a place to read.
   */
  cityNameAr: string | null;
  cityNameEn: string | null;
  regionNameAr: string;
  regionNameEn: string;
  address: string;
  contactName: string;
  contactPhone: string;
}

export const SUPPLIER_REPLACEMENT_DETAIL_KEYS = [
  ...SUPPLIER_REPLACEMENT_SUMMARY_KEYS,
  "preparationStartedAt",
  "readyToShipAt",
  "carrierCode",
  "trackingNumber",
  "disputeId",
  "locationName",
  "cityNameAr",
  "cityNameEn",
  "regionNameAr",
  "regionNameEn",
  "address",
  "contactName",
  "contactPhone",
] as const satisfies readonly (keyof SupplierReplacementDetail)[];

/**
 * The actions, and the ONE state each is claimed from.
 *
 * `ReplacementObligationService` uses the same conditional-UPDATE pattern as
 * order fulfilment, so an action offered from any other state answers 409.
 *
 * `DELIVERED` and `FAILED` are both absent. Delivery is the TRADER'S
 * confirmation — a supplier marking their own replacement delivered would be
 * marking their own homework. `FAILED` is an administrative outcome, not
 * something a supplier declares about their own obligation.
 */
export const SUPPLIER_REPLACEMENT_ACTIONS = {
  AWAITING_PREPARATION: "start-preparation",
  PREPARING: "mark-ready",
  READY_TO_SHIP: "ship",
} as const satisfies Partial<Record<ReplacementObligationStatus, string>>;

export type SupplierReplacementAction =
  (typeof SUPPLIER_REPLACEMENT_ACTIONS)[keyof typeof SUPPLIER_REPLACEMENT_ACTIONS];

/** The action available from a status, or null when there is none. */
export function supplierReplacementAction(
  status: ReplacementObligationStatus
): SupplierReplacementAction | null {
  return (
    (
      SUPPLIER_REPLACEMENT_ACTIONS as Partial<
        Record<ReplacementObligationStatus, SupplierReplacementAction>
      >
    )[status] ?? null
  );
}
