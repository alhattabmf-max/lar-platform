/**
 * Checkout session contracts.
 *
 * FIELD → SOURCE mapping. Every field below is read from a real stored
 * column; nothing is computed in the API and nothing is invented:
 *
 *   id, opportunityId, status          checkout_sessions
 *   quantity                           checkout_sessions.locked_quantity
 *   lockExpiresAt, paymentDeadlineAt   checkout_sessions
 *   salesUnitName*, shareQuantity      quote_snapshots
 *   unitPriceInclTaxAmount             quote_snapshots.unit_price_incl_tax_amount
 *   productsSubtotalExclTaxAmount      quote_snapshots.products_subtotal_excl_tax_amount
 *   productsTaxAmount                  quote_snapshots.products_tax_amount
 *   productsSubtotalInclTaxAmount      quote_snapshots.products_subtotal_incl_tax_amount
 *   totalShippingFeeAmount             quote_snapshots.total_shipping_fee_amount
 *   grandTotalAmount                   quote_snapshots.grand_total_amount
 *   currency                           quote_snapshots.currency
 *   allocations[]                      checkout_location_allocations (*_snapshot columns)
 *   masterOrderId                      checkout_sessions.order (MasterOrder.checkoutSessionId @unique)
 *
 * Every total is SERVER-AUTHORITATIVE. The client displays these values
 * and never recomputes a final figure of its own — a UI that adds up
 * line items will eventually disagree with the amount actually charged.
 *
 * All money is a fixed-scale DECIMAL STRING. These come from
 * Decimal(14,2)/(12,2) columns, and passing them through a JavaScript
 * number would introduce binary floating-point error into figures that
 * get reconciled against a bank statement.
 */

export const CHECKOUT_SESSION_STATUSES = [
  "LOCKED",
  "EXPIRED",
  "ABANDONED",
  "PAYMENT_PENDING",
  "PAID",
] as const;

export type CheckoutSessionStatus = (typeof CHECKOUT_SESSION_STATUSES)[number];

/** Statuses from which nothing further can happen. */
export const TERMINAL_CHECKOUT_STATUSES = ["EXPIRED", "ABANDONED", "PAID"] as const;

export function isTerminalCheckoutStatus(status: CheckoutSessionStatus): boolean {
  return (TERMINAL_CHECKOUT_STATUSES as readonly string[]).includes(status);
}

/**
 * One delivery destination.
 *
 * This is the TRADER'S OWN location, frozen at checkout — their branch,
 * their address, their contact. It is the one place in the product
 * where "delivery city" is the correct term, as opposed to the
 * marketplace's shipping origin.
 *
 * Coordinates are deliberately absent: they exist on the row but mean
 * nothing to a reader, and a raw latitude is not an address.
 */
export interface CheckoutAllocationView {
  /** The trader's own company location. Never another company's. */
  companyLocationId: string;
  locationName: string;
  /**
   * Null when the branch named no city.
   *
   * The region below is never null — a branch always has one — so a
   * reader always has a place to read, and the city refines it when
   * there is one. Rendering an empty string here instead would put a
   * blank where an address belongs.
   */
  cityNameAr: string | null;
  cityNameEn: string | null;
  regionNameAr: string;
  regionNameEn: string;
  address: string;
  quantity: number;
  /** Server-calculated for this destination. Decimal string. */
  shippingFeeAmount: string;
}

export const CHECKOUT_ALLOCATION_VIEW_KEYS = [
  "companyLocationId",
  "locationName",
  "cityNameAr",
  "cityNameEn",
  "regionNameAr",
  "regionNameEn",
  "address",
  "quantity",
  "shippingFeeAmount",
] as const satisfies readonly (keyof CheckoutAllocationView)[];

/** Everything common to a session in any state. */
interface CheckoutSessionBase {
  id: string;
  opportunityId: string;
  quantity: number;
  /** The purchase step. Quantity is always a multiple of this. */
  shareQuantity: number;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  currency: string;
  /** Tax-INCLUSIVE unit price. Decimal string. */
  unitPriceInclTaxAmount: string;
  productsSubtotalExclTaxAmount: string;
  productsTaxAmount: string;
  productsSubtotalInclTaxAmount: string;
  totalShippingFeeAmount: string;
  /** What will actually be charged. Decimal string. */
  grandTotalAmount: string;
  /** ISO 8601. When the inventory lock lapses. */
  lockExpiresAt: string;
  /** ISO 8601, or null before a payment attempt exists. */
  paymentDeadlineAt: string | null;
  allocations: CheckoutAllocationView[];
}

/**
 * A DISCRIMINATED UNION on `status`, so the type system carries the
 * invariant instead of a comment asking people to remember it.
 *
 * The webhook updates the session to PAID and creates the MasterOrder
 * on the SAME transaction client, so the two commit together: a reader
 * who sees PAID sees the order. `PAID` therefore guarantees a
 * `masterOrderId`, and every other status guarantees `null`.
 *
 * That is why there is no "paid but still finalising" variant. It is
 * not a state this system can produce, and modelling it would invite a
 * UI that waits for something that already happened.
 */
export type CheckoutSessionView =
  | (CheckoutSessionBase & { status: "PAID"; masterOrderId: string })
  | (CheckoutSessionBase & {
      status: "LOCKED" | "EXPIRED" | "ABANDONED" | "PAYMENT_PENDING";
      masterOrderId: null;
    });

export const CHECKOUT_SESSION_VIEW_KEYS = [
  "id",
  "opportunityId",
  "status",
  "quantity",
  "shareQuantity",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "currency",
  "unitPriceInclTaxAmount",
  "productsSubtotalExclTaxAmount",
  "productsTaxAmount",
  "productsSubtotalInclTaxAmount",
  "totalShippingFeeAmount",
  "grandTotalAmount",
  "lockExpiresAt",
  "paymentDeadlineAt",
  "allocations",
  "masterOrderId",
] as const satisfies readonly (keyof CheckoutSessionView)[];

/** Narrows to the paid variant, so a caller reaches `masterOrderId` safely. */
export function isPaidCheckoutSession(
  view: CheckoutSessionView
): view is CheckoutSessionBase & { status: "PAID"; masterOrderId: string } {
  return view.status === "PAID";
}

/**
 * The REQUEST body of `POST /trader/checkout-sessions`.
 *
 * This shape was previously declared twice and bound nowhere: once as
 * `CreateCheckoutSessionDto` in the API, where class-validator decorators
 * define it, and once as `CheckoutIntent` in the web app. Two independent
 * definitions of one wire shape drift — a field renamed on one side type-checks
 * perfectly on the other, because the two types were never related.
 *
 * It matters more here than for most request bodies. The server hashes exactly
 * these fields into `idempotency_keys.request_hash`, and the client derives its
 * storage key from a SHA-256 of the same canonical form. If the two shapes ever
 * disagreed, a retry would compute a different fingerprint, claim a different
 * key, and create a SECOND checkout session holding a second quantity lock —
 * with both locks counting toward the trader's cooldown.
 *
 * So this is the single declaration, and both sides are made to satisfy it.
 */

/** One branch of a purchase, and how much of the total goes there. */
export interface CreateCheckoutAllocationRequest {
  /** Must be one of the caller's OWN active locations. The API rejects any other. */
  companyLocationId: string;
  /** A positive whole number. Counts have no decimal part. */
  quantity: number;
}

export const CREATE_CHECKOUT_ALLOCATION_REQUEST_KEYS = [
  "companyLocationId",
  "quantity",
] as const satisfies readonly (keyof CreateCheckoutAllocationRequest)[];

/**
 * What a trader sends to start a checkout session.
 *
 * Three fields, and deliberately no more. There is no price, no total and no
 * shipping figure: every one of those is computed server-side into
 * `quote_snapshots` from the frozen opportunity, and a client that could send
 * one could propose what it pays.
 *
 * The `Idempotency-Key` is a HEADER, not a field. It identifies the operation
 * rather than describing the purchase, and it is deliberately outside the
 * fingerprint the server hashes — otherwise the key would be part of its own
 * identity.
 */
export interface CreateCheckoutSessionRequest {
  opportunityId: string;
  /**
   * The total. Must be a positive multiple of the opportunity's
   * `shareQuantity`, and the allocations must sum to it exactly.
   */
  quantity: number;
  /** At least one. Every entry must name a distinct location. */
  allocations: CreateCheckoutAllocationRequest[];
}

export const CREATE_CHECKOUT_SESSION_REQUEST_KEYS = [
  "opportunityId",
  "quantity",
  "allocations",
] as const satisfies readonly (keyof CreateCheckoutSessionRequest)[];

/**
 * The canonical form the SERVER hashes into `request_hash`.
 *
 * Mirrors `canonicalize()` in `checkout-session.service.ts`. Allocations are
 * sorted by `companyLocationId` so that the same purchase described in a
 * different order produces the same digest — a client that lists its branches
 * differently on a retry must be recognised as retrying, not as buying again.
 *
 * Declared here, beside the request it canonicalises, so a field added to the
 * request has one obvious place to be added to the digest.
 */
export function canonicalCheckoutRequest(request: CreateCheckoutSessionRequest): unknown {
  return {
    opportunityId: request.opportunityId,
    quantity: request.quantity,
    allocations: [...request.allocations]
      .sort((a, b) => a.companyLocationId.localeCompare(b.companyLocationId))
      .map((a) => ({ companyLocationId: a.companyLocationId, quantity: a.quantity })),
  };
}
