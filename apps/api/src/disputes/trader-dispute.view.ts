import { Prisma } from "@prisma/client";
import type {
  DisputeEvidenceView,
  DisputeStatus,
  TraderDisputeDetailView,
} from "@platform/types";

/**
 * Projection for `GET /trader/disputes/:id`.
 *
 * This endpoint previously returned a near-raw row: every evidence
 * record's `storageObjectKey`, every evidence record regardless of who
 * uploaded it — including the SUPPLIER'S — and the administrator's
 * internal `reasonNote`. All three are closed here.
 */

/**
 * Ownership, expressed as a WHERE clause.
 *
 * The dispute's allocation belongs to a master order, and that order
 * carries the trader company. Putting it in the query means an unknown
 * id and another company's dispute produce the identical "no row", so
 * neither can be distinguished by probing — rather than fetching first
 * and comparing afterwards, which is one early return away from
 * answering the wrong company.
 */
export function traderDisputeWhere(
  disputeId: string,
  traderCompanyId: string
): Prisma.DisputeWhereInput {
  return {
    id: disputeId,
    orderAllocation: { masterOrder: { traderCompanyId } },
  };
}

/**
 * Selected columns only.
 *
 * Absent by construction: `decisions[].reasonNote` and
 * `decidedByAdminUserId` (an internal note and a member of staff),
 * `supplierResponse.respondedByUserId`, and the entire `evidence`
 * relation — which is read separately, because it needs a filter this
 * select cannot express.
 */
export const TRADER_DISPUTE_SELECT = {
  id: true,
  orderAllocationId: true,
  reasonCode: true,
  description: true,
  status: true,
  supplierResponseDueAt: true,
  openedAt: true,
  orderAllocation: { select: { masterOrderId: true } },
  supplierResponse: {
    select: { responseType: true, description: true, respondedAt: true },
  },
  decisions: {
    select: { sequenceNumber: true, decisionType: true, decidedAt: true },
    // Deterministic and terminating in the unique pair (disputeId,
    // sequenceNumber). Two decisions on one dispute are a real
    // sequence, and showing them out of order misreports the history.
    orderBy: { sequenceNumber: "asc" },
  },
} satisfies Prisma.DisputeSelect;

export type TraderDisputeRow = Prisma.DisputeGetPayload<{
  select: typeof TRADER_DISPUTE_SELECT;
}>;

/** One evidence row as the raw query returns it. */
export interface TraderEvidenceRow {
  id: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_at: Date;
}

/**
 * The trader COMPANY's own evidence, filtered in the DATABASE.
 *
 * Company-scoped rather than user-scoped on purpose: a colleague who
 * opened the dispute and a colleague reading it later work for the same
 * company, and hiding one from the other would make the feature useless
 * for any company with more than one person.
 *
 * The filter is a join, not a fetch-then-discard. Reading every row and
 * dropping the supplier's afterwards means the supplier's rows were in
 * the process's memory, one logging statement or one forgotten filter
 * away from being served — and it does work proportional to a dispute's
 * whole evidence set to return part of it.
 *
 * Raw SQL because `DisputeEvidence` has `uploadedByUserId` as a plain
 * column with no relation field to `User`, so Prisma cannot express
 * `uploadedByUser.companyId` as a nested filter. Adding that relation
 * would add a foreign key, and therefore a migration.
 *
 * `content_type` and `size_bytes` come from `evidence_uploads`, joined
 * on the storage key. A LEFT join: the upload record is what holds that
 * metadata, and if it is ever missing the evidence still exists and
 * should still be listed — with nulls rather than not at all.
 */
export function traderEvidenceQuery(
  disputeId: string,
  traderCompanyId: string
): Prisma.Sql {
  return Prisma.sql`
    SELECT de.id,
           eu.content_type,
           eu.size_bytes,
           de.uploaded_at
    FROM dispute_evidence de
    JOIN users u ON u.id = de.uploaded_by_user_id
    LEFT JOIN evidence_uploads eu ON eu.storage_object_key = de.storage_object_key
    WHERE de.dispute_id = ${disputeId}::uuid
      AND u.company_id = ${traderCompanyId}::uuid
    ORDER BY de.uploaded_at ASC, de.id ASC
  `;
}

function toEvidence(row: TraderEvidenceRow): DisputeEvidenceView {
  return {
    id: row.id,
    // No storage key, no path, no uploader. A storage key is an
    // internal address, and there is no authorised delivery endpoint
    // to pair it with — so there is nothing a client could do with one
    // except construct a request the platform never sanctioned.
    contentType: row.content_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    uploadedAt: row.uploaded_at.toISOString(),
  };
}

export function toTraderDisputeDetailView(
  row: TraderDisputeRow,
  evidence: TraderEvidenceRow[]
): TraderDisputeDetailView {
  return {
    id: row.id,
    orderId: row.orderAllocation.masterOrderId,
    orderAllocationId: row.orderAllocationId,
    status: row.status as DisputeStatus,
    reasonCode: row.reasonCode,
    description: row.description,
    openedAt: row.openedAt.toISOString(),
    supplierResponseDueAt: row.supplierResponseDueAt.toISOString(),
    supplierResponse: row.supplierResponse
      ? {
          responseType: row.supplierResponse.responseType,
          // Included: a dispute response is written TO the trader, and
          // withholding it would tell them they lost without telling
          // them why. It is counterparty free text, so every consumer
          // must render it as a text node.
          description: row.supplierResponse.description,
          respondedAt: row.supplierResponse.respondedAt.toISOString(),
        }
      : null,
    decisions: row.decisions.map((decision) => ({
      sequenceNumber: decision.sequenceNumber,
      // The EXACT outcome. Four different results live under
      // RESOLVED_*, and collapsing them hides which one occurred.
      decisionType: decision.decisionType,
      decidedAt: decision.decidedAt.toISOString(),
    })),
    evidence: evidence.map(toEvidence),
  };
}
