import type { DisputeStatus } from "./order";
import type { DisputeDecisionView, DisputeEvidenceView } from "./dispute";

/**
 * The supplier's view of a dispute — the mirror of the trader's, and subject to
 * the same per-source rule.
 *
 * `getForSupplier` had exactly the defects `getForTrader` had before 8D.5:
 * ownership compared after the fetch rather than expressed in the query; every
 * evidence row returned, INCLUDING the trader's, each with its
 * `storageObjectKey`; and the administrator's internal `reasonNote`. All three
 * are closed here.
 *
 * What a supplier may see, by source:
 *
 *   the trader's complaint  shown. It is the accusation they must answer, and
 *                           withholding it would make responding impossible.
 *   their own reply         shown. They wrote it.
 *   the decision            the OUTCOME. Not the internal note, not the
 *                           administrator.
 *   evidence                only their OWN company's, and metadata only —
 *                           filtered in SQL, so the trader's attachments are
 *                           never fetched rather than fetched and discarded.
 *
 * The asymmetry with the trader's view is deliberate and small: the trader sees
 * the supplier's reply, and the supplier sees the trader's complaint. Each side
 * reads what the other addressed to them, and neither reads the other's files.
 */

/** The supplier's own reply, once they have made one. */
export interface SupplierDisputeResponseView {
  responseType: string;
  description: string;
  /** ISO 8601. */
  respondedAt: string;
}

export interface SupplierDisputeDetailView {
  id: string;
  /** So the UI can link back to the order without a second read. */
  orderId: string;
  orderAllocationId: string;
  status: DisputeStatus;
  reasonCode: string;
  /**
   * The TRADER'S description of what went wrong.
   *
   * Counterparty free text, addressed to this supplier. Every consumer must
   * render it as a React text node — never as markup, never auto-linked.
   */
  traderDescription: string;
  /** ISO 8601. */
  openedAt: string;
  /** When a response is due. After this the supplier has missed the window. */
  supplierResponseDueAt: string;
  /** Null until they reply. */
  supplierResponse: SupplierDisputeResponseView | null;
  /** The exact outcomes, never collapsed. */
  decisions: DisputeDecisionView[];
  /** Only this SUPPLIER company's own attachments. Metadata only. */
  evidence: DisputeEvidenceView[];
}

export const SUPPLIER_DISPUTE_DETAIL_VIEW_KEYS = [
  "id",
  "orderId",
  "orderAllocationId",
  "status",
  "reasonCode",
  "traderDescription",
  "openedAt",
  "supplierResponseDueAt",
  "supplierResponse",
  "decisions",
  "evidence",
] as const satisfies readonly (keyof SupplierDisputeDetailView)[];

/** One dispute in the supplier's list. */
export interface SupplierDisputeSummary {
  id: string;
  orderId: string;
  allocationId: string;
  status: DisputeStatus;
  reasonCode: string;
  openedAt: string;
  supplierResponseDueAt: string;
  /**
   * True while the SUPPLIER still owes a response.
   *
   * The one thing on this list that needs acting on, computed server-side so a
   * UI does not re-derive a deadline comparison per row.
   */
  awaitingSupplierResponse: boolean;
}

export const SUPPLIER_DISPUTE_SUMMARY_KEYS = [
  "id",
  "orderId",
  "allocationId",
  "status",
  "reasonCode",
  "openedAt",
  "supplierResponseDueAt",
  "awaitingSupplierResponse",
] as const satisfies readonly (keyof SupplierDisputeSummary)[];

/**
 * How a supplier may answer. Mirrors `DisputeSupplierResponseType` exactly.
 *
 * `REPLACEMENT_OFFER` is the fourth and is easy to forget — it is how a
 * supplier proposes sending a replacement instead of a refund, and omitting it
 * from a form would silently remove an option the contract allows.
 */
export const SUPPLIER_DISPUTE_RESPONSE_TYPES = [
  "ACCEPT",
  "REJECT",
  "PARTIAL_ACCEPT",
  "REPLACEMENT_OFFER",
] as const;

export type SupplierDisputeResponseType = (typeof SUPPLIER_DISPUTE_RESPONSE_TYPES)[number];
