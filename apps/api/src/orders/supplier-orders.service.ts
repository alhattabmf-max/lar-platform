import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  MAX_TRADER_PAGE_SIZE,
  type DocumentSummary,
  type MasterOrderStatus,
  type OrderAllocationStatus,
  type Paginated,
  type SupplierAllocationDetail,
  type SupplierOrderDetail,
  type SupplierOrderSummary,
} from "@platform/types";
import { NOT_A_TAX_INVOICE } from "@platform/types";
import { PrismaService } from "../database/prisma.service";

/**
 * The supplier's own orders.
 *
 * `OrdersService.listForSupplier` returned a RAW Prisma row until 8E — the
 * same SELECT the admin list used, carrying `traderCompanyId` and a Decimal
 * `totalAmount` that serialises as a JSON number. This replaces it with an
 * explicit field-by-field projection.
 *
 * The boundary runs the opposite way to the trader's. A supplier sees what
 * they must fulfil, what they are owed and what they are charged; they do not
 * see who bought it. `traderCompanyId`, the trader's tax profile and billing
 * name, the checkout session and the payment attempt are all on the same row
 * and none of them is needed to pack a box.
 *
 * Ownership is IN THE QUERY on every read, so an unknown id and another
 * supplier's order produce the identical "no row" — a 404 either way, with
 * nothing to learn by probing.
 */

interface SupplierScope {
  companyId: string;
}

/** Money as a fixed-scale decimal string. Never a float. */
function money(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

/**
 * Past its preparation deadline with nothing shipped.
 *
 * Computed here rather than in SQL because it compares a stored timestamp
 * against "now", and doing it once per row in one place is what lets the list
 * be a single request.
 */
function isOverdue(
  allocation: {
    status: OrderAllocationStatus;
    preparationDueAt: Date | null;
    shippedAt: Date | null;
  },
  now: Date
): boolean {
  // NO DATE, NO LATENESS — «لا يتم شحن البضاعة إلا بعد ما يتم العرض
  // شروطه ووصوله لهدفه».
  //
  // The due date is NULL while the offer is still gathering its target,
  // because no work is owed yet. It used to be stamped at PAYMENT, which
  // dated work nobody was permitted to start: a supplier whose offer
  // stood at 20% was reported late here, on the admin dashboard, and on
  // his own. Absence is the honest answer, not a comparison against
  // a date that means nothing.
  if (allocation.preparationDueAt === null) return false;
  return allocation.shippedAt === null && allocation.preparationDueAt < now;
}

/**
 * Columns for the LIST.
 *
 * Absent by construction: `traderCompanyId`, `checkoutSessionId`,
 * `paymentAttemptId`, `supplierBankAccountId`, `policyAcceptanceId`,
 * `acceptedByUserId`, every snapshot Json column, and the whole commission
 * derivation (`commissionBase`, `commissionRateBasisPoints`,
 * `commissionTaxRate`, the rule code and version).
 */
const SUPPLIER_ORDER_SUMMARY_SELECT = {
  id: true,
  status: true,
  totalAmount: true,
  supplierPayableAmount: true,
  paidAt: true,
  createdAt: true,
  paymentAttempt: { select: { currency: true } },
  checkoutSession: {
    select: {
      opportunity: {
        select: {
          salesUnitNameAr: true,
          salesUnitNameEn: true,
          productApprovalSnapshot: { select: { snapshot: true } },
        },
      },
    },
  },
  allocations: {
    select: { id: true, status: true, preparationDueAt: true, shippedAt: true },
  },
} satisfies Prisma.MasterOrderSelect;

/**
 * The DETAIL adds the commission the supplier is charged, and the destination
 * of every shipment.
 *
 * The commission figures live here rather than on the summary: they are needed
 * when reconciling a payout, and noise on a list.
 */
const SUPPLIER_ORDER_DETAIL_SELECT = {
  ...SUPPLIER_ORDER_SUMMARY_SELECT,
  commissionAmount: true,
  commissionTaxAmount: true,
  allocations: {
    select: {
      id: true,
      status: true,
      preparationDueAt: true,
      preparationStartedAt: true,
      readyToShipAt: true,
      shippedAt: true,
      deliveredAt: true,
      disputeWindowClosesAt: true,
      payoutSettledAt: true,
      shipmentTracking: { select: { carrierCode: true, trackingNumber: true } },
      dispute: { select: { id: true } },
      financialSnapshot: { select: { supplierPayableShareAmount: true } },
      checkoutLocationAllocation: {
        select: {
          quantity: true,
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
    // Deterministic and terminating in the primary key. Two allocations
    // sharing a deadline must not swap places between requests.
    orderBy: [{ preparationDueAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.MasterOrderSelect;

type SummaryRow = Prisma.MasterOrderGetPayload<{ select: typeof SUPPLIER_ORDER_SUMMARY_SELECT }>;
type DetailRow = Prisma.MasterOrderGetPayload<{ select: typeof SUPPLIER_ORDER_DETAIL_SELECT }>;

/** Product names live in the frozen approval snapshot, not on a live row. */
function productNames(snapshot: Prisma.JsonValue | undefined): {
  nameAr: string;
  nameEn: string;
} {
  const value = (snapshot ?? {}) as Record<string, unknown>;
  return {
    nameAr: typeof value.nameAr === "string" ? value.nameAr : "",
    nameEn: typeof value.nameEn === "string" ? value.nameEn : "",
  };
}

@Injectable()
export class SupplierOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrders(
    scope: SupplierScope,
    query: { page?: number; pageSize?: number }
  ): Promise<Paginated<SupplierOrderSummary>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_TRADER_PAGE_SIZE, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.MasterOrderWhereInput = { supplierCompanyId: scope.companyId };

    const [rows, total] = await Promise.all([
      this.prisma.masterOrder.findMany({
        where,
        select: SUPPLIER_ORDER_SUMMARY_SELECT,
        // Terminating in `id`: `paidAt` is not unique, and a tie spanning a
        // page boundary can serve one row twice and another never.
        orderBy: [{ paidAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.masterOrder.count({ where }),
    ]);

    const now = new Date();
    return { items: rows.map((row) => this.toSummary(row, now)), page, pageSize, total };
  }

  async getOrder(scope: SupplierScope, id: string): Promise<SupplierOrderDetail> {
    const row = await this.prisma.masterOrder.findFirst({
      // Ownership in the query. Never fetched then compared — that is one
      // early return away from answering the wrong company.
      where: { id, supplierCompanyId: scope.companyId },
      select: SUPPLIER_ORDER_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException("Order not found");

    const now = new Date();
    const opportunity = row.checkoutSession.opportunity;

    return {
      ...this.toSummary(row, now),
      salesUnitNameAr: opportunity.salesUnitNameAr,
      salesUnitNameEn: opportunity.salesUnitNameEn,
      // What the platform charges THIS supplier. They are a party to the
      // commission; how it was derived is the platform's business.
      commissionAmount: money(row.commissionAmount),
      commissionTaxAmount: money(row.commissionTaxAmount),
      allocations: row.allocations.map((allocation) => this.toAllocation(allocation, now)),
    };
  }

  /**
   * Internal documents for one order.
   *
   * The supplier sees `INTERNAL_COMMISSION_DRAFT` — unlike the trader, who
   * does not. It records what the platform charges the SUPPLIER, and billing
   * someone without letting them see what for is not defensible.
   *
   * `snapshotData` is never selected. Every item carries the legal notice, and
   * there is no PDF, QR code or ZATCA identifier on this shape at all.
   */
  async listDocuments(scope: SupplierScope, masterOrderId: string): Promise<DocumentSummary[]> {
    const order = await this.prisma.masterOrder.findFirst({
      where: { id: masterOrderId, supplierCompanyId: scope.companyId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException("Order not found");

    const documents = await this.prisma.invoiceDocument.findMany({
      where: { masterOrderId },
      select: {
        id: true,
        documentType: true,
        amount: true,
        currency: true,
        issuedAt: true,
        internalDocumentReference: true,
      },
      orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
    });

    return documents.map((document) => ({
      id: document.id,
      documentType: document.documentType as DocumentSummary["documentType"],
      amount: money(document.amount),
      currency: document.currency,
      issuedAt: iso(document.issuedAt),
      internalDocumentReference: document.internalDocumentReference,
      notice: NOT_A_TAX_INVOICE,
    }));
  }

  private toSummary(row: SummaryRow, now: Date): SupplierOrderSummary {
    const product = productNames(row.checkoutSession.opportunity.productApprovalSnapshot?.snapshot);

    return {
      id: row.id,
      status: row.status as MasterOrderStatus,
      totalAmount: money(row.totalAmount),
      supplierPayableAmount: money(row.supplierPayableAmount),
      currency: row.paymentAttempt.currency,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      allocationCount: row.allocations.length,
      // Aggregated here so a list of twenty orders is one request rather than
      // twenty-one.
      awaitingPreparationCount: row.allocations.filter(
        (a) => a.status === "AWAITING_PREPARATION"
      ).length,
      deliveredAllocationCount: row.allocations.filter((a) => a.status === "DELIVERED").length,
      hasOverduePreparation: row.allocations.some((a) =>
        isOverdue({ status: a.status, preparationDueAt: a.preparationDueAt, shippedAt: a.shippedAt }, now)
      ),
      paidAt: iso(row.paidAt),
      createdAt: iso(row.createdAt),
    };
  }

  private toAllocation(
    allocation: DetailRow["allocations"][number],
    now: Date
  ): SupplierAllocationDetail {
    const destination = allocation.checkoutLocationAllocation;

    return {
      id: allocation.id,
      status: allocation.status as OrderAllocationStatus,
      quantity: destination.quantity,
      // The trader's branch, frozen at checkout. The supplier is shipping
      // there, so they get the address and someone to call — and no
      // coordinate, which is not an address.
      locationName: destination.locationNameSnapshot,
      cityNameAr: destination.cityNameArSnapshot,
      cityNameEn: destination.cityNameEnSnapshot,
      regionNameAr: destination.regionNameArSnapshot,
      regionNameEn: destination.regionNameEnSnapshot,
      address: destination.addressSnapshot,
      contactName: destination.contactNameSnapshot,
      contactPhone: destination.contactPhoneSnapshot,
      // ABSENT UNTIL THE OFFER CLOSES — see `isOverdue`.
      preparationDueAt: isoOrNull(allocation.preparationDueAt),
      isPreparationOverdue: isOverdue(
        {
          status: allocation.status,
          preparationDueAt: allocation.preparationDueAt,
          shippedAt: allocation.shippedAt,
        },
        now
      ),
      preparationStartedAt: isoOrNull(allocation.preparationStartedAt),
      readyToShipAt: isoOrNull(allocation.readyToShipAt),
      shippedAt: isoOrNull(allocation.shippedAt),
      deliveredAt: isoOrNull(allocation.deliveredAt),
      carrierCode: allocation.shipmentTracking?.carrierCode ?? null,
      trackingNumber: allocation.shipmentTracking?.trackingNumber ?? null,
      supplierPayableShareAmount: allocation.financialSnapshot
        ? money(allocation.financialSnapshot.supplierPayableShareAmount)
        : "0.00",
      disputeId: allocation.dispute?.id ?? null,
      // A timestamp, not a payout id: the settlement is read from
      // /supplier/settlements under its own ownership check.
      payoutSettledAt: isoOrNull(allocation.payoutSettledAt),
    };
  }
}
