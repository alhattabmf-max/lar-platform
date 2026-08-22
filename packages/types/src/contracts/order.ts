/**
 * Trader-facing order contracts.
 *
 * The boundary these encode: a trader sees what they bought, where it
 * is going, and how far along it is. They never see the platform's
 * commission, the supplier's payable amount, the supplier's bank
 * account, any ledger posting, or the raw snapshots those are computed
 * from. Those exist on the same rows — which is exactly why the
 * projection is explicit field by field, and why a test asserts the key
 * set rather than trusting a `select`.
 */

/** Two values only — there is no CANCELLED or PENDING master order. */
export const MASTER_ORDER_STATUSES = ["IN_FULFILLMENT", "FULFILLED"] as const;
export type MasterOrderStatus = (typeof MASTER_ORDER_STATUSES)[number];

export const ORDER_ALLOCATION_STATUSES = [
  "AWAITING_PREPARATION",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPED",
  "DELIVERED",
] as const;
export type OrderAllocationStatus = (typeof ORDER_ALLOCATION_STATUSES)[number];

/**
 * Seven values, and the four RESOLVED_* are NOT interchangeable.
 *
 * Collapsing them into one "Resolved" would hide which outcome
 * actually occurred — whether the trader was refunded, partially
 * refunded, rejected, or sent a replacement.
 */
export const DISPUTE_STATUSES = [
  "OPEN",
  "SUPPLIER_RESPONDED",
  "AWAITING_REPLACEMENT",
  "RESOLVED_ACCEPTED",
  "RESOLVED_PARTIAL",
  "RESOLVED_REJECTED",
  "RESOLVED_REPLACED",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const REPLACEMENT_OBLIGATION_STATUSES = [
  "AWAITING_PREPARATION",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPED",
  "DELIVERED",
  "FAILED",
] as const;
export type ReplacementObligationStatus = (typeof REPLACEMENT_OBLIGATION_STATUSES)[number];

export const INVOICE_DOCUMENT_TYPES = [
  "INTERNAL_PRODUCT_DRAFT",
  "INTERNAL_COMMISSION_DRAFT",
  "INTERNAL_ADJUSTMENT_DRAFT",
] as const;
export type InvoiceDocumentType = (typeof INVOICE_DOCUMENT_TYPES)[number];

/**
 * The mandatory notice on every internal document.
 *
 * A closed constant, not a message key: it is a legal statement whose
 * exact value is load-bearing, and it must be impossible to render a
 * document view without it. Affirmative tax-invoice claims, tax PDFs,
 * QR codes, ZATCA references, Clearance and Reporting are all
 * prohibited — see the plan's §5.2.
 */
export const NOT_A_TAX_INVOICE = "NOT_A_TAX_INVOICE" as const;
export type TaxInvoiceNotice = typeof NOT_A_TAX_INVOICE;

/** Documents a trader may see. `INTERNAL_COMMISSION_DRAFT` is withheld. */
export const TRADER_VISIBLE_DOCUMENT_TYPES = [
  "INTERNAL_PRODUCT_DRAFT",
  "INTERNAL_ADJUSTMENT_DRAFT",
] as const;
export type TraderVisibleDocumentType = (typeof TRADER_VISIBLE_DOCUMENT_TYPES)[number];

/**
 * One order in the trader's list.
 *
 * `allocationCount` and `deliveredAllocationCount` are aggregated
 * server-side so a list of twenty orders is one request, not
 * twenty-one. Without them the UI would have to open every order to
 * show progress.
 */
export interface OrderSummary {
  id: string;
  status: MasterOrderStatus;
  /** Decimal string — never a float. */
  totalAmount: string;
  currency: string;
  productNameAr: string;
  productNameEn: string;
  allocationCount: number;
  deliveredAllocationCount: number;
  /** True when any allocation is past its preparation due date and not yet shipped. */
  hasOverduePreparation: boolean;
  /** ISO 8601. */
  paidAt: string;
  createdAt: string;
}

export const ORDER_SUMMARY_KEYS = [
  "id",
  "status",
  "totalAmount",
  "currency",
  "productNameAr",
  "productNameEn",
  "allocationCount",
  "deliveredAllocationCount",
  "hasOverduePreparation",
  "paidAt",
  "createdAt",
] as const satisfies readonly (keyof OrderSummary)[];

/**
 * Where one allocation is going, and how far it has got.
 *
 * The delivery address is the TRADER'S OWN, captured at checkout — it
 * is their location, not counterparty data. Carrier code and tracking
 * number are the trader's means of following their own shipment.
 */
export interface OrderAllocationDetail {
  id: string;
  status: OrderAllocationStatus;
  quantity: number;
  locationName: string;
  cityNameAr: string;
  cityNameEn: string;
  regionNameAr: string;
  regionNameEn: string;
  address: string;
  /** ISO 8601. When preparation is contractually due. */
  preparationDueAt: string;
  /** True when `preparationDueAt` has passed and nothing has shipped. */
  isPreparationOverdue: boolean;
  preparationStartedAt: string | null;
  readyToShipAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  /** Null until shipped. */
  carrierCode: string | null;
  trackingNumber: string | null;
  /** Null until delivered. After it passes, no dispute can be opened. */
  disputeWindowClosesAt: string | null;
  /** The trader's own dispute on this allocation, if any. */
  disputeId: string | null;
}

export const ORDER_ALLOCATION_DETAIL_KEYS = [
  "id",
  "status",
  "quantity",
  "locationName",
  "cityNameAr",
  "cityNameEn",
  "regionNameAr",
  "regionNameEn",
  "address",
  "preparationDueAt",
  "isPreparationOverdue",
  "preparationStartedAt",
  "readyToShipAt",
  "shippedAt",
  "deliveredAt",
  "carrierCode",
  "trackingNumber",
  "disputeWindowClosesAt",
  "disputeId",
] as const satisfies readonly (keyof OrderAllocationDetail)[];

/**
 * The order detail, with its allocations INLINE.
 *
 * There is deliberately no `GET /trader/order-allocations/:id`: an
 * allocation is only ever meaningful within its order, and a separate
 * endpoint would be a second ownership boundary to get right for no
 * gain.
 */
export interface OrderDetail extends OrderSummary {
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  allocations: OrderAllocationDetail[];
}

export const ORDER_DETAIL_KEYS = [
  ...ORDER_SUMMARY_KEYS,
  "salesUnitNameAr",
  "salesUnitNameEn",
  "allocations",
] as const satisfies readonly (keyof OrderDetail)[];

/**
 * An internal document, derived — never the raw `snapshotData`.
 *
 * `notice` is always present and always `NOT_A_TAX_INVOICE`. There is
 * no field for a PDF, a QR code, or any ZATCA identifier, so a view
 * cannot render one by accident.
 */
export interface DocumentSummary {
  id: string;
  documentType: TraderVisibleDocumentType;
  amount: string;
  currency: string;
  issuedAt: string;
  internalDocumentReference: string;
  notice: TaxInvoiceNotice;
}

export const DOCUMENT_SUMMARY_KEYS = [
  "id",
  "documentType",
  "amount",
  "currency",
  "issuedAt",
  "internalDocumentReference",
  "notice",
] as const satisfies readonly (keyof DocumentSummary)[];

/**
 * A dispute in the trader's list.
 *
 * `reasonCode` and `status` are closed vocabularies the UI translates.
 * The trader's OWN description is included — they wrote it. The
 * supplier's response body and any evidence content are not.
 */
export interface DisputeSummary {
  id: string;
  orderId: string;
  allocationId: string;
  status: DisputeStatus;
  reasonCode: string;
  openedAt: string;
  supplierResponseDueAt: string;
  /** True while the trader is waiting on someone else. */
  awaitingCounterparty: boolean;
}

export const DISPUTE_SUMMARY_KEYS = [
  "id",
  "orderId",
  "allocationId",
  "status",
  "reasonCode",
  "openedAt",
  "supplierResponseDueAt",
  "awaitingCounterparty",
] as const satisfies readonly (keyof DisputeSummary)[];

/** A replacement obligation the trader is owed. */
export interface ReplacementSummary {
  id: string;
  orderId: string;
  allocationId: string;
  status: ReplacementObligationStatus;
  replacementQuantity: number;
  createdAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
}

export const REPLACEMENT_SUMMARY_KEYS = [
  "id",
  "orderId",
  "allocationId",
  "status",
  "replacementQuantity",
  "createdAt",
  "shippedAt",
  "deliveredAt",
  "failedAt",
] as const satisfies readonly (keyof ReplacementSummary)[];

/** Detail adds carrier tracking for a replacement in transit. */
export interface ReplacementDetail extends ReplacementSummary {
  preparationStartedAt: string | null;
  readyToShipAt: string | null;
  carrierCode: string | null;
  trackingNumber: string | null;
  /** The dispute whose decision created this obligation. */
  disputeId: string;
}

export const REPLACEMENT_DETAIL_KEYS = [
  ...REPLACEMENT_SUMMARY_KEYS,
  "preparationStartedAt",
  "readyToShipAt",
  "carrierCode",
  "trackingNumber",
  "disputeId",
] as const satisfies readonly (keyof ReplacementDetail)[];

/**
 * Ceiling on every trader list.
 *
 * Lower than the platform-wide MAX_PAGE_SIZE for the same reason the
 * notification list is: these are screens someone reads, not exports.
 */
export const MAX_TRADER_PAGE_SIZE = 50;
export const DEFAULT_TRADER_PAGE_SIZE = 20;
