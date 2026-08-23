import { Prisma } from "@prisma/client";
import type {
  DisputeEvidenceView,
  DisputeStatus,
  SupplierDisputeDetailView,
  SupplierDisputeSummary,
} from "@platform/types";

/**
 * Projection for the supplier's dispute surfaces.
 *
 * `getForSupplier` had exactly the three defects `getForTrader` had before
 * 8D.5 closed them:
 *
 *   1. ownership compared AFTER the fetch, not expressed in the query;
 *   2. every evidence row returned — including the TRADER'S — each carrying
 *      its `storageObjectKey`;
 *   3. the administrator's internal `reasonNote` on every decision.
 *
 * All three are closed here, the same way.
 */

/**
 * Ownership, as a WHERE clause.
 *
 * The dispute's allocation belongs to a master order, which carries the
 * supplier company. As a filter, an unknown id and another supplier's dispute
 * both produce no row — one 404, nothing distinguishable by probing.
 */
export function supplierDisputeWhere(
  disputeId: string,
  supplierCompanyId: string
): Prisma.DisputeWhereInput {
  return {
    id: disputeId,
    orderAllocation: { masterOrder: { supplierCompanyId } },
  };
}

/** Every dispute raised against this supplier. */
export function supplierDisputeListWhere(supplierCompanyId: string): Prisma.DisputeWhereInput {
  return { orderAllocation: { masterOrder: { supplierCompanyId } } };
}

/**
 * Selected columns only.
 *
 * Absent by construction: `decisions[].reasonNote` and `decidedByAdminUserId`
 * (an internal note and a member of staff), `supplierResponse.respondedByUserId`,
 * and the entire `evidence` relation — which is read separately because it
 * needs a filter this select cannot express.
 */
export const SUPPLIER_DISPUTE_SELECT = {
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
    // Two decisions on one dispute are a real sequence; showing them out of
    // order misreports the history.
    orderBy: { sequenceNumber: "asc" },
  },
} satisfies Prisma.DisputeSelect;

export type SupplierDisputeRow = Prisma.DisputeGetPayload<{
  select: typeof SUPPLIER_DISPUTE_SELECT;
}>;

/** One evidence row as the raw query returns it. */
export interface SupplierEvidenceRow {
  id: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_at: Date;
}

/**
 * The supplier COMPANY's own evidence, filtered in the DATABASE.
 *
 * Company-scoped rather than user-scoped: a colleague who uploaded the file and
 * a colleague reading the dispute later work for the same company, and hiding
 * one from the other makes the feature useless for any company with more than
 * one person.
 *
 * The filter is a join, not a fetch-then-discard. Reading every row and
 * dropping the trader's afterwards puts the trader's attachments in the
 * process's memory, one logging statement or one forgotten filter away from
 * being served.
 *
 * Raw SQL because `DisputeEvidence.uploadedByUserId` is a plain column with no
 * relation field to `User`, so Prisma cannot express `uploadedByUser.companyId`
 * as a nested filter. Adding that relation would add a foreign key, and
 * therefore a migration.
 */
export function supplierEvidenceQuery(disputeId: string, supplierCompanyId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT de.id,
           eu.content_type,
           eu.size_bytes,
           de.uploaded_at
    FROM dispute_evidence de
    JOIN users u ON u.id = de.uploaded_by_user_id
    LEFT JOIN evidence_uploads eu ON eu.storage_object_key = de.storage_object_key
    WHERE de.dispute_id = ${disputeId}::uuid
      AND u.company_id = ${supplierCompanyId}::uuid
    ORDER BY de.uploaded_at ASC, de.id ASC
  `;
}

function toEvidence(row: SupplierEvidenceRow): DisputeEvidenceView {
  return {
    id: row.id,
    // No storage key, no path, no uploader. A storage key is an internal
    // address, and there is no authorised delivery endpoint to pair it with.
    contentType: row.content_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    uploadedAt: row.uploaded_at.toISOString(),
  };
}

/**
 * True while the supplier still owes a response.
 *
 * `OPEN` is the only status in which the ball is with them: once they have
 * responded the dispute moves on, and every RESOLVED_* state is finished.
 * Computed here so a list does not re-derive it per row.
 */
export function awaitsSupplierResponse(status: string): boolean {
  return status === "OPEN";
}

export function toSupplierDisputeSummary(row: {
  id: string;
  orderAllocationId: string;
  status: string;
  reasonCode: string;
  openedAt: Date;
  supplierResponseDueAt: Date;
  orderAllocation: { masterOrderId: string };
}): SupplierDisputeSummary {
  return {
    id: row.id,
    orderId: row.orderAllocation.masterOrderId,
    allocationId: row.orderAllocationId,
    status: row.status as DisputeStatus,
    reasonCode: row.reasonCode,
    openedAt: row.openedAt.toISOString(),
    supplierResponseDueAt: row.supplierResponseDueAt.toISOString(),
    awaitingSupplierResponse: awaitsSupplierResponse(row.status),
  };
}

export function toSupplierDisputeDetailView(
  row: SupplierDisputeRow,
  evidence: SupplierEvidenceRow[]
): SupplierDisputeDetailView {
  return {
    id: row.id,
    orderId: row.orderAllocation.masterOrderId,
    orderAllocationId: row.orderAllocationId,
    status: row.status as DisputeStatus,
    reasonCode: row.reasonCode,
    // The trader's own words — the accusation this supplier must answer.
    // Withholding it would make responding impossible. It is counterparty
    // free text, so every consumer must render it as a text node.
    traderDescription: row.description,
    openedAt: row.openedAt.toISOString(),
    supplierResponseDueAt: row.supplierResponseDueAt.toISOString(),
    supplierResponse: row.supplierResponse
      ? {
          responseType: row.supplierResponse.responseType,
          description: row.supplierResponse.description,
          respondedAt: row.supplierResponse.respondedAt.toISOString(),
        }
      : null,
    decisions: row.decisions.map((decision) => ({
      sequenceNumber: decision.sequenceNumber,
      // The EXACT outcome. Four different results live under RESOLVED_*, and
      // collapsing them hides which one occurred.
      decisionType: decision.decisionType,
      decidedAt: decision.decidedAt.toISOString(),
    })),
    evidence: evidence.map(toEvidence),
  };
}
