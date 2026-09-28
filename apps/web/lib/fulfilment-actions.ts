import {
  SUPPLIER_ALLOCATION_ACTIONS,
  SUPPLIER_REPLACEMENT_ACTIONS,
  type OrderAllocationStatus,
  type ReplacementObligationStatus,
} from "@platform/types";

/**
 * Which fulfilment step the API will accept next.
 *
 * Both vocabularies come from `@platform/types`, which transcribes the
 * services' own transition guards. Each is a partial map from a status to
 * the ONE action available in it — an absent status means there is nothing
 * for the supplier to do, and a control must not be drawn.
 *
 * DELIVERED IS NOT A SUPPLIER ACTION and never appears here. Confirming
 * delivery belongs to the trader (or, by exception, an administrator with a
 * recorded reason). A supplier button for it would be a claim about someone
 * else's goods.
 *
 * THE SERVER IS THE AUTHORITY. Every transition is claimed with a
 * conditional UPDATE and answers 409 when the row has moved on, so this
 * exists to avoid drawing a button that is certain to fail — not to decide
 * anything.
 */

/** The action path segment for an allocation, or null. */
export function allocationAction(status: OrderAllocationStatus): string | null {
  return (SUPPLIER_ALLOCATION_ACTIONS as Partial<Record<string, string>>)[status] ?? null;
}

/** The action path segment for a replacement obligation, or null. */
export function replacementAction(status: ReplacementObligationStatus): string | null {
  return (SUPPLIER_REPLACEMENT_ACTIONS as Partial<Record<string, string>>)[status] ?? null;
}

/**
 * True when the action needs carrier details.
 *
 * `ship` takes a `ShipDto` — `carrierCode` and `trackingNumber`, both
 * required non-empty strings. The other two take no body at all, so a form
 * would be asking for something the endpoint ignores.
 */
export function actionNeedsTracking(action: string | null): boolean {
  return action === "ship";
}

