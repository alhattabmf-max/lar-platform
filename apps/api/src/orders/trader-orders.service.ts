import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_TRADER_PAGE_SIZE,
  MAX_TRADER_PAGE_SIZE,
  NOT_A_TAX_INVOICE,
  TRADER_VISIBLE_DOCUMENT_TYPES,
  type DisputeSummary,
  type DocumentSummary,
  type MasterOrderStatus,
  type OrderAllocationDetail,
  type OrderAllocationStatus,
  type OrderDetail,
  type OrderSummary,
  type Paginated,
  type ReplacementDetail,
  type ReplacementSummary,
  type TraderVisibleDocumentType,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";

/**
 * Everything a trader reads about their own orders.
 *
 * OWNERSHIP IS IN THE QUERY. Every statement is constrained by
 * `traderCompanyId = session.companyId` — never fetched and then
 * checked, which would leak existence through timing and through any
 * error that escaped the check. A non-match is a **404, not a 403**:
 * a 403 confirms the id exists.
 *
 * WHAT IS WITHHELD, on rows that carry it: `commissionBase`,
 * `commissionRateBasisPoints`, `commissionAmount`, `commissionTax*`,
 * `supplierPayableAmount`, `supplierBankAccountId`, the supplier's
 * legal name / CR / tax / invoicing snapshots, `policyAcceptanceId`,
 * and every ledger posting. The projections below are explicit field
 * by field for that reason — a spread would forward all of it.
 */

/** Money as a fixed-scale decimal string; never a float. */
function money(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}

const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

interface SnapshotProduct {
  nameAr: string;
  nameEn: string;
}

function parseProduct(raw: unknown): SnapshotProduct {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    nameAr: typeof value.nameAr === "string" ? value.nameAr : "",
    nameEn: typeof value.nameEn === "string" ? value.nameEn : "",
  };
}

/**
 * An allocation is overdue when its preparation deadline has passed and
 * it has not shipped.
 *
 * Computed server-side so every screen agrees, and so the list can show
 * "needs attention" without opening each order.
 */
function isOverdue(
  allocation: { preparationDueAt: Date | null; shippedAt: Date | null; status: string },
  now: Date
): boolean {
  if (allocation.shippedAt !== null) return false;
  if (allocation.status === "SHIPPED" || allocation.status === "DELIVERED") return false;
  // NO DATE, NO LATENESS. The clock starts when the offer closes, not
  // when this buyer paid — so while the offer is still gathering its
  // target there is nothing to be late against.
  if (allocation.preparationDueAt === null) return false;
  return allocation.preparationDueAt.getTime() < now.getTime();
}

const ORDER_SELECT = {
  id: true,
  status: true,
  totalAmount: true,
  paidAt: true,
  createdAt: true,
  paymentAttempt: { select: { currency: true } },
  // MasterOrder carries opportunityId but no relation to Opportunity;
  // the checkout session is the declared path to it.
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

const ALLOCATION_SELECT = {
  id: true,
  status: true,
  preparationDueAt: true,
  preparationStartedAt: true,
  readyToShipAt: true,
  shippedAt: true,
  deliveredAt: true,
  disputeWindowClosesAt: true,
  checkoutLocationAllocation: {
    select: {
      quantity: true,
      locationNameSnapshot: true,
      cityNameArSnapshot: true,
      cityNameEnSnapshot: true,
      regionNameArSnapshot: true,
      regionNameEnSnapshot: true,
      addressSnapshot: true,
    },
  },
  shipmentTracking: { select: { carrierCode: true, trackingNumber: true } },
  dispute: { select: { id: true } },
} satisfies Prisma.OrderAllocationSelect;

export interface TraderScope {
  companyId: string;
}

interface PageQuery {
  page?: number;
  pageSize?: number;
}

@Injectable()
export class TraderOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private bounds(query: PageQuery): { page: number; pageSize: number; skip: number } {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      MAX_TRADER_PAGE_SIZE,
      Math.max(1, query.pageSize ?? DEFAULT_TRADER_PAGE_SIZE)
    );
    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  async listOrders(scope: TraderScope, query: PageQuery): Promise<Paginated<OrderSummary>> {
    const { page, pageSize, skip } = this.bounds(query);
    const where: Prisma.MasterOrderWhereInput = { traderCompanyId: scope.companyId };

    const [rows, total] = await Promise.all([
      this.prisma.masterOrder.findMany({
        where,
        select: ORDER_SELECT,
        // A TOTAL order: `createdAt` is not unique, and a tie spanning a
        // page boundary can serve one row twice and never serve another.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.masterOrder.count({ where }),
    ]);

    const now = new Date();
    return { items: rows.map((row) => this.toSummary(row, now)), page, pageSize, total };
  }

  async getOrder(scope: TraderScope, masterOrderId: string): Promise<OrderDetail> {
    const order = await this.prisma.masterOrder.findFirst({
      // Ownership in the WHERE, not a check afterwards.
      where: { id: masterOrderId, traderCompanyId: scope.companyId },
      select: { ...ORDER_SELECT, allocations: { select: ALLOCATION_SELECT } },
    });
    if (!order) throw new NotFoundException("Order not found");

    const now = new Date();
    const allocations = order.allocations.map((allocation) => this.toAllocation(allocation, now));

    return {
      ...this.toSummary(
        {
          ...order,
          allocations: order.allocations.map((a) => ({
            id: a.id,
            status: a.status,
            preparationDueAt: a.preparationDueAt,
            shippedAt: a.shippedAt,
          })),
        },
        now
      ),
      salesUnitNameAr: order.checkoutSession.opportunity.salesUnitNameAr,
      salesUnitNameEn: order.checkoutSession.opportunity.salesUnitNameEn,
      // Deterministic: allocations are shown in a stable order rather
      // than whatever the database happened to return.
      allocations: allocations.sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  /**
   * Internal documents for one order.
   *
   * `INTERNAL_COMMISSION_DRAFT` is excluded IN THE QUERY, not filtered
   * afterwards — commission is between the platform and the supplier,
   * and the trader is not a party to it. The raw `snapshotData` is
   * never selected at all.
   */
  async listDocuments(scope: TraderScope, masterOrderId: string): Promise<DocumentSummary[]> {
    const order = await this.prisma.masterOrder.findFirst({
      where: { id: masterOrderId, traderCompanyId: scope.companyId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException("Order not found");

    const documents = await this.prisma.invoiceDocument.findMany({
      where: {
        masterOrderId: order.id,
        documentType: { in: [...TRADER_VISIBLE_DOCUMENT_TYPES] },
      },
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
      documentType: document.documentType as TraderVisibleDocumentType,
      amount: money(document.amount),
      currency: document.currency,
      issuedAt: document.issuedAt.toISOString(),
      internalDocumentReference: document.internalDocumentReference,
      // Always present, always this value. There is no code path that
      // renders one of these documents without it.
      notice: NOT_A_TAX_INVOICE,
    }));
  }

  async listDisputes(scope: TraderScope, query: PageQuery): Promise<Paginated<DisputeSummary>> {
    const { page, pageSize, skip } = this.bounds(query);
    const where: Prisma.DisputeWhereInput = {
      orderAllocation: { masterOrder: { traderCompanyId: scope.companyId } },
    };

    const [rows, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        select: {
          id: true,
          status: true,
          reasonCode: true,
          openedAt: true,
          supplierResponseDueAt: true,
          orderAllocationId: true,
          orderAllocation: { select: { masterOrderId: true } },
        },
        orderBy: [{ openedAt: "desc" }, { id: "asc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        orderId: row.orderAllocation.masterOrderId,
        allocationId: row.orderAllocationId,
        status: row.status,
        reasonCode: row.reasonCode,
        openedAt: row.openedAt.toISOString(),
        supplierResponseDueAt: row.supplierResponseDueAt.toISOString(),
        // OPEN and AWAITING_REPLACEMENT are the states where the trader
        // is waiting on someone else and has nothing to do.
        awaitingCounterparty: row.status === "OPEN" || row.status === "AWAITING_REPLACEMENT",
      })),
      page,
      pageSize,
      total,
    };
  }

  async listReplacements(
    scope: TraderScope,
    query: PageQuery
  ): Promise<Paginated<ReplacementSummary>> {
    const { page, pageSize, skip } = this.bounds(query);
    const where: Prisma.ReplacementObligationWhereInput = {
      originalOrderAllocation: { masterOrder: { traderCompanyId: scope.companyId } },
    };

    const [rows, total] = await Promise.all([
      this.prisma.replacementObligation.findMany({
        where,
        select: this.replacementSelect(),
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.replacementObligation.count({ where }),
    ]);

    return { items: rows.map((row) => this.toReplacement(row)), page, pageSize, total };
  }

  /**
   * One replacement obligation.
   *
   * This is the destination a `REPLACEMENT_FAILED` notification points
   * at — until it existed, that notification had nowhere to go.
   */
  async getReplacement(scope: TraderScope, replacementId: string): Promise<ReplacementDetail> {
    const row = await this.prisma.replacementObligation.findFirst({
      where: {
        id: replacementId,
        originalOrderAllocation: { masterOrder: { traderCompanyId: scope.companyId } },
      },
      select: {
        ...this.replacementSelect(),
        preparationStartedAt: true,
        readyToShipAt: true,
        shipmentTracking: { select: { carrierCode: true, trackingNumber: true } },
        disputeDecision: { select: { disputeId: true } },
      },
    });
    if (!row) throw new NotFoundException("Replacement obligation not found");

    return {
      ...this.toReplacement(row),
      preparationStartedAt: iso(row.preparationStartedAt),
      readyToShipAt: iso(row.readyToShipAt),
      carrierCode: row.shipmentTracking?.carrierCode ?? null,
      trackingNumber: row.shipmentTracking?.trackingNumber ?? null,
      disputeId: row.disputeDecision.disputeId,
    };
  }

  private replacementSelect() {
    return {
      id: true,
      status: true,
      replacementQuantity: true,
      createdAt: true,
      shippedAt: true,
      deliveredAt: true,
      failedAt: true,
      originalOrderAllocationId: true,
      originalOrderAllocation: { select: { masterOrderId: true } },
    } satisfies Prisma.ReplacementObligationSelect;
  }

  private toReplacement(row: {
    id: string;
    status: string;
    replacementQuantity: number;
    createdAt: Date;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    failedAt: Date | null;
    originalOrderAllocationId: string;
    originalOrderAllocation: { masterOrderId: string };
  }): ReplacementSummary {
    return {
      id: row.id,
      orderId: row.originalOrderAllocation.masterOrderId,
      allocationId: row.originalOrderAllocationId,
      status: row.status as ReplacementSummary["status"],
      replacementQuantity: row.replacementQuantity,
      createdAt: row.createdAt.toISOString(),
      shippedAt: iso(row.shippedAt),
      deliveredAt: iso(row.deliveredAt),
      failedAt: iso(row.failedAt),
    };
  }

  private toSummary(
    row: {
      id: string;
      status: string;
      totalAmount: Prisma.Decimal;
      paidAt: Date;
      createdAt: Date;
      paymentAttempt: { currency: string };
      checkoutSession: { opportunity: { productApprovalSnapshot: { snapshot: Prisma.JsonValue } | null } };
      allocations: { id: string; status: string; preparationDueAt: Date | null; shippedAt: Date | null }[];
    },
    now: Date
  ): OrderSummary {
    const product = parseProduct(row.checkoutSession.opportunity.productApprovalSnapshot?.snapshot);

    return {
      id: row.id,
      status: row.status as MasterOrderStatus,
      totalAmount: money(row.totalAmount),
      // From the payment attempt, which is where the captured currency
      // actually lives — not re-derived from anything.
      currency: row.paymentAttempt.currency,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      allocationCount: row.allocations.length,
      deliveredAllocationCount: row.allocations.filter((a) => a.status === "DELIVERED").length,
      hasOverduePreparation: row.allocations.some((a) => isOverdue(a, now)),
      paidAt: row.paidAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toAllocation(
    row: Prisma.OrderAllocationGetPayload<{ select: typeof ALLOCATION_SELECT }>,
    now: Date
  ): OrderAllocationDetail {
    const location = row.checkoutLocationAllocation;

    return {
      id: row.id,
      status: row.status as OrderAllocationStatus,
      quantity: location.quantity,
      // The trader's OWN delivery location, captured at checkout.
      locationName: location.locationNameSnapshot,
      cityNameAr: location.cityNameArSnapshot,
      cityNameEn: location.cityNameEnSnapshot,
      regionNameAr: location.regionNameArSnapshot,
      regionNameEn: location.regionNameEnSnapshot,
      address: location.addressSnapshot,
      // NULL UNTIL THE OFFER CLOSES — see `isOverdue`. `iso` already
      // carries an absence through; `toISOString` on nothing throws.
      preparationDueAt: iso(row.preparationDueAt),
      isPreparationOverdue: isOverdue(row, now),
      preparationStartedAt: iso(row.preparationStartedAt),
      readyToShipAt: iso(row.readyToShipAt),
      shippedAt: iso(row.shippedAt),
      deliveredAt: iso(row.deliveredAt),
      carrierCode: row.shipmentTracking?.carrierCode ?? null,
      trackingNumber: row.shipmentTracking?.trackingNumber ?? null,
      disputeWindowClosesAt: iso(row.disputeWindowClosesAt),
      disputeId: row.dispute?.id ?? null,
    };
  }
}
