import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AdminOrderDetail, AdminOrderItem, Paginated } from "@platform/types";
import { PrismaService } from "../database/prisma.service";

/**
 * The ADMIN's view of orders.
 *
 * The trader reads moved to TraderOrdersService in 8D.3 and the
 * supplier reads to SupplierOrdersService in 8E.2. Both were deleted
 * rather than left orphaned: the projection below carries
 * `supplierPayableAmount` — what the platform owes the supplier, which
 * a buyer must never see — alongside `traderCompanyId`, which a
 * supplier must never see. A method named for either party pointing at
 * this shape is an invitation to call it again.
 *
 * MONEY. `totalAmount` and `supplierPayableAmount` are
 * `Decimal(14,2)` columns. Handing a Prisma `Decimal` to
 * `JSON.stringify` calls its `toString()`, so a stored `100.00` left
 * this endpoint as `"100"` — a string that fails
 * `MONEY_STRING_PATTERN`, sorts differently, and would not line up in a
 * reconciliation against a bank statement. `toFixed(2)` is now the only
 * producer, matching every other money surface in the system.
 */

const money = (amount: Prisma.Decimal): string => amount.toFixed(2);

const ROW_SELECT = {
  id: true,
  status: true,
  totalAmount: true,
  supplierPayableAmount: true,
  paidAt: true,
  createdAt: true,
  opportunityId: true,
  traderCompanyId: true,
  supplierCompanyId: true,
  supplierLegalNameSnapshot: true,
  // The count, not the rows. A list shows how many shipments an order
  // has; the rows themselves belong to the detail, where one order has
  // been opened on purpose.
  _count: { select: { allocations: true } },
} as const;

const ALLOCATION_SELECT = {
  id: true,
  status: true,
  expectedPreparationDays: true,
  preparationDueAt: true,
  checkoutLocationAllocationId: true,
} as const;

type OrderRow = Prisma.MasterOrderGetPayload<{ select: typeof ROW_SELECT }>;

/** The default page. Orders accumulate without bound; a list must not. */
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface AdminOrdersQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  traderCompanyId?: string;
  supplierCompanyId?: string;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async listForAdmin(query: AdminOrdersQuery = {}): Promise<Paginated<AdminOrderItem>> {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE)));

    const where: Prisma.MasterOrderWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.traderCompanyId ? { traderCompanyId: query.traderCompanyId } : {}),
      ...(query.supplierCompanyId ? { supplierCompanyId: query.supplierCompanyId } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.masterOrder.findMany({
        where,
        select: ROW_SELECT,
        // Terminating in `id` so two orders created in the same
        // millisecond cannot swap places between page 1 and page 2 and
        // hide one of themselves.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.masterOrder.count({ where }),
    ]);

    const traderNames = await this.traderNames(rows);

    return {
      items: rows.map((row) => this.toItem(row, traderNames)),
      total,
      page,
      pageSize,
    };
  }

  async getForAdmin(id: string): Promise<AdminOrderDetail> {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id },
      select: { ...ROW_SELECT, allocations: { select: ALLOCATION_SELECT, orderBy: { id: "asc" } } },
    });
    if (!order) throw new NotFoundException("Order not found");

    const { allocations, ...row } = order;
    const traderNames = await this.traderNames([row]);

    return {
      ...this.toItem(row, traderNames),
      allocations: allocations.map((allocation) => ({
        id: allocation.id,
        status: allocation.status,
        expectedPreparationDays: allocation.expectedPreparationDays,
        preparationDueAt: allocation.preparationDueAt?.toISOString() ?? null,
        checkoutLocationAllocationId: allocation.checkoutLocationAllocationId,
      })),
    };
  }

  /**
   * Trader legal names for the rows in hand.
   *
   * ONE query keyed by ids already fetched, not a relation include and
   * not a lookup per row. `MasterOrder` has a `supplierLegalNameSnapshot`
   * but no trader equivalent that is always present —
   * `traderBillingLegalNameSnapshot` is an override and is usually null
   * — so the buyer's current name is read from `Company`.
   */
  private async traderNames(rows: Array<Pick<OrderRow, "traderCompanyId">>): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.traderCompanyId))];
    if (ids.length === 0) return new Map();

    const companies = await this.prisma.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, legalName: true },
    });

    return new Map(companies.map((company) => [company.id, company.legalName]));
  }

  private toItem(row: OrderRow, traderNames: Map<string, string>): AdminOrderItem {
    return {
      id: row.id,
      status: row.status,
      totalAmount: money(row.totalAmount),
      supplierPayableAmount: money(row.supplierPayableAmount),
      opportunityId: row.opportunityId,
      traderCompanyId: row.traderCompanyId,
      // Empty string, not a placeholder word: a deleted company is not
      // a state this schema has, so this branch should be unreachable,
      // and a fabricated "Unknown" would read as data.
      traderCompanyLegalName: traderNames.get(row.traderCompanyId) ?? "",
      supplierCompanyId: row.supplierCompanyId,
      supplierCompanyLegalName: row.supplierLegalNameSnapshot,
      allocationCount: row._count.allocations,
      paidAt: row.paidAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
