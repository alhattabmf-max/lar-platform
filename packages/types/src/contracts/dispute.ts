import type { DisputeStatus } from "./order";

/**
 * The trader's view of one dispute.
 *
 * Three parties write into a dispute — the trader, the supplier, and an
 * administrator deciding it — so what may be shown is decided per
 * source rather than by whether a column happens to be on the row:
 *
 *   the trader's own      shown. They wrote it.
 *   the supplier's reply  shown. It is a response addressed TO them.
 *   the admin's decision  the OUTCOME is shown; the internal note and
 *                         the deciding administrator are not.
 *   evidence              only their own COMPANY's, and only metadata.
 *
 * Every field below exists on a real column. Nothing is invented, and
 * nothing that exists is included merely because it exists.
 */

/**
 * What a supplier's reply can be. A closed vocabulary the UI
 * translates — never a raw enum shown to a reader.
 */
export const DISPUTE_SUPPLIER_RESPONSE_TYPES = [
  "ACCEPT",
  "REJECT",
  "PARTIAL_ACCEPT",
  "REPLACEMENT_OFFER",
] as const;
export type DisputeSupplierResponseType = (typeof DISPUTE_SUPPLIER_RESPONSE_TYPES)[number];

/**
 * The administrator's decision, as the trader sees it.
 *
 * `reasonNote` is deliberately absent: it is an internal note written
 * for the platform's own record, not correspondence with either party.
 * `decidedByAdminUserId` is absent for the same reason it is absent
 * from every other trader-facing shape — which member of staff decided
 * something is not the trader's business, and naming them invites
 * pressure on an individual.
 */
/**
 * What an administrator can decide. Mirrors `DisputeDecisionType`.
 *
 * `REJECTED` here is the DECISION; `RESOLVED_REJECTED` is the dispute
 * STATUS that follows from it. They are different vocabularies and are
 * translated separately.
 */
export const DISPUTE_DECISION_TYPES = [
  "FULL_REFUND",
  "PARTIAL_REFUND",
  "REJECTED",
  "REPLACEMENT",
] as const;
export type DisputeDecisionType = (typeof DISPUTE_DECISION_TYPES)[number];

export interface DisputeDecisionView {
  sequenceNumber: number;
  /**
   * The exact outcome, never collapsed.
   *
   * `RESOLVED_ACCEPTED`, `RESOLVED_PARTIAL`, `RESOLVED_REJECTED` and
   * `RESOLVED_REPLACED` are four different results — refunded in full,
   * refunded in part, refused, and replaced. Rendering them all as
   * "Resolved" would hide which one actually happened.
   */
  decisionType: string;
  /** ISO 8601. */
  decidedAt: string;
}

/**
 * One piece of evidence, as METADATA only.
 *
 * There is no `storageObjectKey`, no path, no bucket, no uploader id.
 * A storage key is an internal address: exposing one tells a client
 * where the platform keeps its files and invites a request built from
 * it.
 *
 * There is also no download URL, and that is a stated gap rather than
 * an oversight — no per-resource authorised delivery endpoint exists
 * for dispute evidence, so a link could only be forged from the object
 * key. Metadata lets someone confirm their file arrived and what it
 * was; retrieving it waits for a real secured endpoint.
 *
 * `contentType` and `sizeBytes` come from `evidence_uploads`, which
 * records exactly those two and nothing file-embedded — no EXIF, no
 * original filename. There is therefore no filename field here: the
 * column does not exist, and inventing one would mean deriving it from
 * the storage key.
 */
export interface DisputeEvidenceView {
  id: string;
  /** From `evidence_uploads.content_type`. Null if the upload row is gone. */
  contentType: string | null;
  /** From `evidence_uploads.size_bytes`. Null if the upload row is gone. */
  sizeBytes: number | null;
  /** ISO 8601. When it was attached to the dispute. */
  uploadedAt: string;
}

export const DISPUTE_EVIDENCE_VIEW_KEYS = [
  "id",
  "contentType",
  "sizeBytes",
  "uploadedAt",
] as const satisfies readonly (keyof DisputeEvidenceView)[];

/**
 * The supplier's reply.
 *
 * `description` IS included: a dispute response is written to the
 * trader, and withholding it would leave them told only that they lost
 * without being told why. It is free text from a counterparty, so it
 * must be rendered as a React text node — never as markup, never
 * auto-linked.
 *
 * `respondedByUserId` is absent: which individual at the supplier
 * replied is not the trader's business.
 */
export interface DisputeSupplierResponseView {
  responseType: string;
  description: string;
  /** ISO 8601. */
  respondedAt: string;
}

export interface TraderDisputeDetailView {
  id: string;
  /** The order this dispute belongs to, so the UI can link back. */
  orderId: string;
  orderAllocationId: string;
  status: DisputeStatus;
  reasonCode: string;
  /** The TRADER'S own description. They wrote it. */
  description: string;
  /** ISO 8601. */
  openedAt: string;
  supplierResponseDueAt: string;
  supplierResponse: DisputeSupplierResponseView | null;
  decisions: DisputeDecisionView[];
  /** Only this trader COMPANY's own attachments. Metadata only. */
  evidence: DisputeEvidenceView[];
}

export const TRADER_DISPUTE_DETAIL_VIEW_KEYS = [
  "id",
  "orderId",
  "orderAllocationId",
  "status",
  "reasonCode",
  "description",
  "openedAt",
  "supplierResponseDueAt",
  "supplierResponse",
  "decisions",
  "evidence",
] as const satisfies readonly (keyof TraderDisputeDetailView)[];

/**
 * The content types dispute evidence may be uploaded as.
 *
 * Mirrors `EvidenceUploadService`'s own allowlist, exported so the file
 * picker offers exactly what the server accepts — rather than letting
 * someone choose a file that is rejected after it uploads.
 */
export const DISPUTE_EVIDENCE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;

/** 10 MiB, matching the server's own limit. */
export const DISPUTE_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

/** The most attachments one dispute may carry, matching `OpenDisputeDto`. */
export const DISPUTE_EVIDENCE_MAX_COUNT = 10;

/** The reasons a trader may open a dispute, matching `OpenDisputeDto`. */
export const DISPUTE_REASON_CODES = [
  "ITEM_NOT_RECEIVED",
  "ITEM_DAMAGED",
  "ITEM_INCORRECT",
  "QUANTITY_SHORTAGE",
  "QUALITY_ISSUE",
  "OTHER",
] as const;

export type DisputeReasonCode = (typeof DISPUTE_REASON_CODES)[number];

/** Matches `OpenDisputeDto`'s own bounds, so the form fails before the request does. */
export const DISPUTE_DESCRIPTION_MIN_LENGTH = 5;
export const DISPUTE_DESCRIPTION_MAX_LENGTH = 2000;
