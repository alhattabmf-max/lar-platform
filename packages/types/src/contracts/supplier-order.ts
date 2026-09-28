import type { MasterOrderStatus, OrderAllocationStatus } from "./order";

/**
 * Supplier-facing order contracts.
 *
 * The mirror image of the trader's, and the boundary runs the other way. A
 * supplier sees what they must fulfil, what they are owed, and how far along
 * each shipment is. They do NOT see who bought it: the trader's company id,
 * legal name, billing profile and tax profile are all on the same row, and
 * none of them is needed to pack a box.
 *
 * `supplier/orders` returned a raw Prisma row until 8E — `traderCompanyId`
 * included, `totalAmount` as a Decimal that serialises to a JSON number, and
 * the same SELECT the ADMIN list used. Every field below is chosen; nothing
 * arrives because it happened to be on the model.
 *
 * WHAT A SUPPLIER MAY SEE OF THE MONEY. `supplierPayableAmount` is what they
 * are paid, and `commissionAmount`/`commissionTaxAmount` are what the platform
 * charges THEM — they are a party to that commission, so withholding it would
 * mean billing someone without telling them what for. What stays out is the
 * derivation: `commissionBase`, `commissionRateBasisPoints`, the tax rule code
 * and version. Those describe how the platform prices, not what this supplier
 * owes.
 */

/** One order in the supplier's list. */
export interface SupplierOrderSummary {
  id: string;
  status: MasterOrderStatus;
  /** What the trader paid. Decimal string. */
  totalAmount: string;
  /** What this supplier receives. Decimal string. */
  supplierPayableAmount: string;
  currency: string;
  productNameAr: string;
  productNameEn: string;
  allocationCount: number;
  /**
   * Aggregated server-side, so a list of twenty orders is one request rather
   * than twenty-one.
   */
  awaitingPreparationCount: number;
  deliveredAllocationCount: number;
  /**
   * True when any allocation is past `preparationDueAt` and has not shipped.
   *
   * This is the supplier's OWN overdue — the same flag the trader sees, read
   * from the same columns. It is the one thing on this list that needs acting
   * on, so it is computed once here rather than derived per row in a UI.
   */
  hasOverduePreparation: boolean;
  /** ISO 8601. */
  paidAt: string;
  createdAt: string;
}

export const SUPPLIER_ORDER_SUMMARY_KEYS = [
  "id",
  "status",
  "totalAmount",
  "supplierPayableAmount",
  "currency",
  "productNameAr",
  "productNameEn",
  "allocationCount",
  "awaitingPreparationCount",
  "deliveredAllocationCount",
  "hasOverduePreparation",
  "paidAt",
  "createdAt",
] as const satisfies readonly (keyof SupplierOrderSummary)[];

/**
 * One shipment the supplier owes, with where it is going.
 *
 * The destination is the TRADER'S branch, and the supplier needs it — they are
 * shipping there. What they get is the city, the region and the short address,
 * which is what a courier needs. They do not get the trader's company identity,
 * and they do not get coordinates: a latitude is not an address.
 *
 * `contactName` and `contactPhone` ARE included. A carrier cannot deliver to a
 * building without someone to call, and these are captured at checkout for
 * exactly that purpose.
 */
export interface SupplierAllocationDetail {
  id: string;
  status: OrderAllocationStatus;
  quantity: number;
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
  /** ISO 8601. When preparation is contractually due. */
  /**
   * NULL WHILE THE OFFER IS STILL GATHERING ITS TARGET.
   *
   * The clock starts when the offer closes, not when a buyer paid — so
   * a supplier sees no date, and no action, until the target is in.
   */
  preparationDueAt: string | null;
  /** True when `preparationDueAt` has passed and nothing has shipped. */
  isPreparationOverdue: boolean;
  preparationStartedAt: string | null;
  readyToShipAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  /** Null until the supplier ships. Their own carrier and number. */
  carrierCode: string | null;
  trackingNumber: string | null;
  /** This allocation's share of the payable. Decimal string. */
  supplierPayableShareAmount: string;
  /** The dispute the trader opened on this allocation, if any. */
  disputeId: string | null;
  /**
   * Whether this allocation has been paid out.
   *
   * A timestamp, not a payout id: the settlement itself is read from
   * `/supplier/settlements`, and linking by id here would invite a second
   * ownership boundary for no gain.
   */
  payoutSettledAt: string | null;
}

export const SUPPLIER_ALLOCATION_DETAIL_KEYS = [
  "id",
  "status",
  "quantity",
  "locationName",
  "cityNameAr",
  "cityNameEn",
  "regionNameAr",
  "regionNameEn",
  "address",
  "contactName",
  "contactPhone",
  "preparationDueAt",
  "isPreparationOverdue",
  "preparationStartedAt",
  "readyToShipAt",
  "shippedAt",
  "deliveredAt",
  "carrierCode",
  "trackingNumber",
  "supplierPayableShareAmount",
  "disputeId",
  "payoutSettledAt",
] as const satisfies readonly (keyof SupplierAllocationDetail)[];

/**
 * The order detail, allocations INLINE.
 *
 * There is no `GET /supplier/order-allocations/:id`, for the same reason there
 * is none on the trader side: an allocation is only meaningful within its
 * order, and a separate route would be a second ownership boundary to get right
 * for nothing in return.
 *
 * The commission figures appear HERE rather than on the summary. They are what
 * the supplier is charged for this order — needed when reconciling a payout,
 * and noise on a list.
 */
export interface SupplierOrderDetail extends SupplierOrderSummary {
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  /** What the platform charges this supplier for this order. Decimal string. */
  commissionAmount: string;
  /** VAT on that commission. Decimal string. */
  commissionTaxAmount: string;
  allocations: SupplierAllocationDetail[];
}

export const SUPPLIER_ORDER_DETAIL_KEYS = [
  ...SUPPLIER_ORDER_SUMMARY_KEYS,
  "salesUnitNameAr",
  "salesUnitNameEn",
  "commissionAmount",
  "commissionTaxAmount",
  "allocations",
] as const satisfies readonly (keyof SupplierOrderDetail)[];

/**
 * The fulfilment actions, and the ONE state each is claimed from.
 *
 * `OrderAllocationService` claims every transition with a conditional UPDATE —
 * `WHERE id = ... AND status = '<from>'` — and answers 409 when it moves zero
 * rows. Exporting the mapping means a UI offers an action from exactly the
 * state the server accepts it from, rather than offering one that fails.
 *
 * `DELIVERED` is absent, and its absence is the point: delivery is confirmed by
 * the TRADER, or by an administrator. A supplier marking their own shipment
 * delivered would be marking their own homework, and it starts the dispute
 * window.
 */
export const SUPPLIER_ALLOCATION_ACTIONS = {
  AWAITING_PREPARATION: "start-preparation",
  PREPARING: "mark-ready",
  READY_TO_SHIP: "ship",
} as const satisfies Partial<Record<OrderAllocationStatus, string>>;

export type SupplierAllocationAction =
  (typeof SUPPLIER_ALLOCATION_ACTIONS)[keyof typeof SUPPLIER_ALLOCATION_ACTIONS];

/** The action available from a status, or null when there is none. */
export function supplierAllocationAction(
  status: OrderAllocationStatus
): SupplierAllocationAction | null {
  return (
    (SUPPLIER_ALLOCATION_ACTIONS as Partial<Record<OrderAllocationStatus, SupplierAllocationAction>>)[
      status
    ] ?? null
  );
}
