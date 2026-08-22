import { Prisma } from "@prisma/client";
import type {
  CheckoutAllocationView,
  CheckoutSessionStatus,
  CheckoutSessionView,
} from "@platform/types";

/**
 * Projection for `GET /trader/checkout-sessions/:id`.
 *
 * The endpoint previously returned a raw Prisma row with the whole
 * quote snapshot and every allocation column included. This replaces
 * that with an explicit, field-by-field mapping — a spread would
 * forward the tax rule code, the shipping tariff policy version, the
 * provider code, the trader company snapshot and the raw coordinates
 * along with it.
 */

/** Money as a fixed-scale decimal string. Never a float. */
const money = (amount: Prisma.Decimal): string => amount.toFixed(2);
const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/**
 * Selected columns only.
 *
 * Absent by construction: `traderCompanySnapshot`, `releaseReason`,
 * `lockCreatedAt`, `lockReleasedAt`, `capturedAt`, every commission and
 * supplier-payable figure (which live on MasterOrder, not selected
 * here), the tax rule code and version, the shipping tariff policy
 * version, the shipping provider code, the product approval snapshot
 * id, payment attempts, provider references and idempotency keys.
 */
export const CHECKOUT_SESSION_VIEW_SELECT = {
  id: true,
  opportunityId: true,
  status: true,
  lockedQuantity: true,
  lockExpiresAt: true,
  paymentDeadlineAt: true,
  quoteSnapshot: {
    select: {
      salesUnitNameAr: true,
      salesUnitNameEn: true,
      shareQuantity: true,
      currency: true,
      unitPriceInclTaxAmount: true,
      productsSubtotalExclTaxAmount: true,
      productsTaxAmount: true,
      productsSubtotalInclTaxAmount: true,
      totalShippingFeeAmount: true,
      grandTotalAmount: true,
    },
  },
  allocations: {
    select: {
      companyLocationId: true,
      locationNameSnapshot: true,
      cityNameArSnapshot: true,
      cityNameEnSnapshot: true,
      regionNameArSnapshot: true,
      regionNameEnSnapshot: true,
      addressSnapshot: true,
      quantity: true,
      shippingFeeAmount: true,
    },
    // Deterministic and terminating in the primary key. Without this
    // the row order is whatever the plan returns, and two reads of the
    // same session could list the destinations differently.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  // The exact relation, not a search. MasterOrder.checkoutSessionId is
  // @unique, so this is a one-to-one lookup — the client never has to
  // scan an order list or guess at "the most recent one".
  order: { select: { id: true } },
} satisfies Prisma.CheckoutSessionSelect;

export type CheckoutSessionRow = Prisma.CheckoutSessionGetPayload<{
  select: typeof CHECKOUT_SESSION_VIEW_SELECT;
}>;

/**
 * Raised when a session is PAID but carries no MasterOrder.
 *
 * The webhook updates the session to PAID and creates the order on the
 * same transaction client, so this state cannot arise from the normal
 * path — seeing it means the relational graph is corrupt or a future
 * code path broke the atomicity.
 *
 * It is a safe internal failure, deliberately: returning a contradictory
 * response would push the problem into the UI, and a fallback would
 * hide corruption behind something that looks fine. The message names
 * only the session id — no company, no amount — and the global filter
 * turns it into a generic 500 with a request id.
 */
export class CheckoutInvariantError extends Error {
  constructor(checkoutSessionId: string) {
    super(
      `Checkout session ${checkoutSessionId} is PAID but has no master order — ` +
        "these are written on one transaction, so this indicates corrupt relations"
    );
    this.name = "CheckoutInvariantError";
  }
}

function toAllocation(row: CheckoutSessionRow["allocations"][number]): CheckoutAllocationView {
  return {
    companyLocationId: row.companyLocationId,
    locationName: row.locationNameSnapshot,
    cityNameAr: row.cityNameArSnapshot,
    cityNameEn: row.cityNameEnSnapshot,
    regionNameAr: row.regionNameArSnapshot,
    regionNameEn: row.regionNameEnSnapshot,
    address: row.addressSnapshot,
    quantity: row.quantity,
    shippingFeeAmount: money(row.shippingFeeAmount),
    // Coordinates are selected nowhere and mapped nowhere.
  };
}

/**
 * Maps a row onto the discriminated union.
 *
 * The union is the point: `PAID` carries a `masterOrderId: string` and
 * every other status carries `null`, so a consumer cannot read an order
 * id that might not be there, and this mapper cannot emit a
 * contradictory pair.
 */
export function toCheckoutSessionView(row: CheckoutSessionRow): CheckoutSessionView {
  const quote = row.quoteSnapshot;
  if (!quote) {
    // A session without its quote cannot be priced, and inventing zeros
    // would show someone a total that is not what they will pay.
    throw new CheckoutInvariantError(row.id);
  }

  const base = {
    id: row.id,
    opportunityId: row.opportunityId,
    quantity: row.lockedQuantity,
    shareQuantity: quote.shareQuantity,
    salesUnitNameAr: quote.salesUnitNameAr,
    salesUnitNameEn: quote.salesUnitNameEn,
    currency: quote.currency,
    unitPriceInclTaxAmount: money(quote.unitPriceInclTaxAmount),
    productsSubtotalExclTaxAmount: money(quote.productsSubtotalExclTaxAmount),
    productsTaxAmount: money(quote.productsTaxAmount),
    productsSubtotalInclTaxAmount: money(quote.productsSubtotalInclTaxAmount),
    totalShippingFeeAmount: money(quote.totalShippingFeeAmount),
    grandTotalAmount: money(quote.grandTotalAmount),
    lockExpiresAt: row.lockExpiresAt.toISOString(),
    paymentDeadlineAt: iso(row.paymentDeadlineAt),
    allocations: row.allocations.map(toAllocation),
  };

  if (row.status === "PAID") {
    if (!row.order) throw new CheckoutInvariantError(row.id);
    return { ...base, status: "PAID", masterOrderId: row.order.id };
  }

  return {
    ...base,
    status: row.status as Exclude<CheckoutSessionStatus, "PAID">,
    masterOrderId: null,
  };
}
