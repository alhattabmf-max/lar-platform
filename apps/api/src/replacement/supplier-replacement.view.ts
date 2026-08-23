import { Prisma } from "@prisma/client";
import type {
  ReplacementObligationStatus,
  SupplierReplacementDetail,
  SupplierReplacementSummary,
} from "@platform/types";

/**
 * Projection for the supplier's replacement obligations.
 *
 * There was no read surface for these at all before 8E: only the three POST
 * actions existed, so a supplier could be told to send a replacement and had
 * no way to see what they owed. `REPLACEMENT_REQUIRED` is a notification with
 * an ACTION_REQUIRED urgency that, until now, pointed nowhere.
 *
 * This is NOT the trader's projection reused. Theirs answers "where is my
 * replacement?"; this answers "what must I send, and by when?" — different
 * fields, and a different set of valid actions. Sharing one shape would have
 * meant a role flag choosing between them, and a flag is one wrong argument
 * away from offering a supplier the trader's delivery confirmation.
 */

/**
 * Ownership, as a WHERE clause.
 *
 * A replacement hangs off the ORIGINAL allocation, which belongs to a master
 * order carrying the supplier company. Expressed as a filter, an unknown id
 * and another supplier's obligation both produce no row — one 404, nothing
 * distinguishable by probing.
 */
export function supplierReplacementWhere(
  supplierCompanyId: string
): Prisma.ReplacementObligationWhereInput {
  return {
    originalOrderAllocation: { masterOrder: { supplierCompanyId } },
  };
}

/**
 * Selected columns only.
 *
 * The dispute this arose from is reduced to its ID. The supplier is on the
 * losing side of that decision and may open the dispute under its own
 * boundary — but the complaint text, the administrator's reasoning and the
 * evidence do not travel here, where none of them would be filtered.
 */
export const SUPPLIER_REPLACEMENT_SUMMARY_SELECT = {
  id: true,
  originalOrderAllocationId: true,
  status: true,
  replacementQuantity: true,
  createdAt: true,
  shippedAt: true,
  deliveredAt: true,
  failedAt: true,
  originalOrderAllocation: { select: { masterOrderId: true } },
} satisfies Prisma.ReplacementObligationSelect;

export const SUPPLIER_REPLACEMENT_DETAIL_SELECT = {
  ...SUPPLIER_REPLACEMENT_SUMMARY_SELECT,
  preparationStartedAt: true,
  readyToShipAt: true,
  shipmentTracking: { select: { carrierCode: true, trackingNumber: true } },
  disputeDecision: { select: { disputeId: true } },
  originalOrderAllocation: {
    select: {
      masterOrderId: true,
      // A replacement goes where the original went, so the destination is
      // read through the original allocation's frozen checkout snapshot.
      checkoutLocationAllocation: {
        select: {
          locationNameSnapshot: true,
          cityNameArSnapshot: true,
          cityNameEnSnapshot: true,
          regionNameArSnapshot: true,
          regionNameEnSnapshot: true,
          addressSnapshot: true,
          contactNameSnapshot: true,
          contactPhoneSnapshot: true,
        },
      },
    },
  },
} satisfies Prisma.ReplacementObligationSelect;

export type SupplierReplacementSummaryRow = Prisma.ReplacementObligationGetPayload<{
  select: typeof SUPPLIER_REPLACEMENT_SUMMARY_SELECT;
}>;
export type SupplierReplacementDetailRow = Prisma.ReplacementObligationGetPayload<{
  select: typeof SUPPLIER_REPLACEMENT_DETAIL_SELECT;
}>;

/**
 * True while this needs the supplier to do something.
 *
 * Anything before SHIPPED. Once shipped, the next move is the trader's
 * confirmation; DELIVERED and FAILED are finished. Computed once here so a
 * list does not re-derive it per row, and so the same rule drives both the
 * flag and the action.
 */
export function awaitsSupplierAction(status: ReplacementObligationStatus): boolean {
  return (
    status === "AWAITING_PREPARATION" || status === "PREPARING" || status === "READY_TO_SHIP"
  );
}

const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toSupplierReplacementSummary(
  row: SupplierReplacementSummaryRow
): SupplierReplacementSummary {
  const status = row.status as ReplacementObligationStatus;

  return {
    id: row.id,
    orderId: row.originalOrderAllocation.masterOrderId,
    originalOrderAllocationId: row.originalOrderAllocationId,
    status,
    replacementQuantity: row.replacementQuantity,
    createdAt: row.createdAt.toISOString(),
    shippedAt: isoOrNull(row.shippedAt),
    deliveredAt: isoOrNull(row.deliveredAt),
    failedAt: isoOrNull(row.failedAt),
    awaitingSupplierAction: awaitsSupplierAction(status),
  };
}

export function toSupplierReplacementDetail(
  row: SupplierReplacementDetailRow
): SupplierReplacementDetail {
  const destination = row.originalOrderAllocation.checkoutLocationAllocation;

  return {
    ...toSupplierReplacementSummary(row),
    preparationStartedAt: isoOrNull(row.preparationStartedAt),
    readyToShipAt: isoOrNull(row.readyToShipAt),
    carrierCode: row.shipmentTracking?.carrierCode ?? null,
    trackingNumber: row.shipmentTracking?.trackingNumber ?? null,
    disputeId: row.disputeDecision.disputeId,
    // The destination, and someone to call. A carrier cannot deliver to a
    // building without a contact — and a coordinate is not an address, so
    // none is selected.
    locationName: destination.locationNameSnapshot,
    cityNameAr: destination.cityNameArSnapshot,
    cityNameEn: destination.cityNameEnSnapshot,
    regionNameAr: destination.regionNameArSnapshot,
    regionNameEn: destination.regionNameEnSnapshot,
    address: destination.addressSnapshot,
    contactName: destination.contactNameSnapshot,
    contactPhone: destination.contactPhoneSnapshot,
  };
}
