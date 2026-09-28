import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AdminRefundItem,
  AdminSettlementItem,
  Paginated,
} from "@platform/types";
import { PrismaService } from "../../database/prisma.service";

/**
 * The two money read surfaces that had actions but no way to reach them.
 *
 * `POST /admin/refund-obligations/:id/attempts` and
 * `POST /admin/order-allocations/:id/settle` both existed while nothing
 * listed what to act on — an operator had to already know an id.
 *
 * MONEY IS A DECIMAL STRING. These are `Decimal(14,2)` columns
 * reconciled against bank statements; `Decimal.toFixed(2)` only, never
 * `toNumber()`.
 *
 * `externalTransferReference` IS carried on the settlement shape and is
 * the one field the SUPPLIER's own settlement view deliberately omits.
 * The operator performed the transfer and needs the bank's reference to
 * reconcile it; it must never travel to a supplier surface.
 *
 * `executedByAdminUserId` is NOT carried even here. Who pressed the
 * button is an audit question, answered by the audit log with its own
 * actor field — decorating every payout row with a colleague's id
 * spreads that fact across a surface that does not need it.
 *
 * No ledger posting, no journal entry, no bank account id, no IBAN.
 */

/** Money as a fixed-scale decimal string. Never a float. */
const money = (amount: Prisma.Decimal): string => amount.toFixed(2);

interface ListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
}

function paging(query: ListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

const REFUND_SELECT = {
  id: true,
  paymentAttemptId: true,
  source: true,
  reasonCode: true,
  status: true,
  amount: true,
  currency: true,
  createdAt: true,
  // A refund hangs off a PAYMENT ATTEMPT, and reaches an order only
  // through that attempt's checkout session. Selected as the one link
  // needed to navigate, not as an embedded order.
  paymentAttempt: {
    // `CheckoutSession`'s back-relation to the order is named `order`,
    // not `masterOrder` — the scalar side lives on MasterOrder.
    select: { checkoutSession: { select: { order: { select: { id: true } } } } },
  },
  // THE RETRY COUNT IS NOT SELECTED HERE. `_count: { attempts: true }`
  // compiles to a LEFT JOIN against `SELECT refund_obligation_id,
  // COUNT(*) FROM refund_attempts GROUP BY refund_obligation_id` — the
  // whole attempt history, aggregated before this page's `take` is
  // reached, and the ordering index unusable while it happens. It is
  // counted for the page's own rows instead, below.
} satisfies Prisma.RefundObligationSelect;

const SETTLEMENT_SELECT = {
  id: true,
  orderAllocationId: true,
  outcome: true,
  externalTransferReference: true,
  netAmount: true,
  executedAt: true,
  orderAllocation: {
    select: {
      masterOrderId: true,
      masterOrder: {
        select: {
          supplierCompanyId: true,
          paymentAttempt: { select: { currency: true } },
          // No `supplierCompany` relation exists: MasterOrder carries the
          // company FKs as scalars only. The names are resolved in one
          // batched follow-up query rather than by adding a relation to
          // the schema, which would be a migration.
        },
      },
    },
  },
} satisfies Prisma.SupplierPayoutSelect;

@Injectable()
export class AdminMoneyReadsService {
  constructor(private readonly prisma: PrismaService) {}

  async listRefunds(query: ListQuery): Promise<Paginated<AdminRefundItem>> {
    const { page, pageSize, skip, take } = paging(query);

    const where: Prisma.RefundObligationWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.refundObligation.findMany({
        where,
        select: REFUND_SELECT,
        // Terminating in the primary key: `createdAt` is not unique, and
        // a tie spanning a page boundary can serve one row twice and
        // another never.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip,
        take,
      }),
      this.prisma.refundObligation.count({ where }),
    ]);

    const attemptCounts = new Map(
      rows.length === 0
        ? []
        : (
            await this.prisma.refundAttempt.groupBy({
              by: ["refundObligationId"],
              where: { refundObligationId: { in: rows.map((row) => row.id) } },
              _count: { _all: true },
            })
          ).map((row) => [row.refundObligationId, row._count._all] as const)
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        paymentAttemptId: row.paymentAttemptId,
        masterOrderId: row.paymentAttempt.checkoutSession.order?.id ?? null,
        source: row.source as AdminRefundItem["source"],
        reasonCode: row.reasonCode,
        status: row.status as AdminRefundItem["status"],
        amount: money(row.amount),
        currency: row.currency,
        attemptCount: attemptCounts.get(row.id) ?? 0,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  async listSettlements(
    query: ListQuery & { outcome?: string; supplierCompanyId?: string }
  ): Promise<Paginated<AdminSettlementItem>> {
    const { page, pageSize, skip, take } = paging(query);

    const where: Prisma.SupplierPayoutWhereInput = {
      ...(query.outcome ? { outcome: query.outcome as never } : {}),
      ...(query.supplierCompanyId
        ? { orderAllocation: { masterOrder: { supplierCompanyId: query.supplierCompanyId } } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.supplierPayout.findMany({
        where,
        select: SETTLEMENT_SELECT,
        orderBy: [{ executedAt: "desc" }, { id: "asc" }],
        skip,
        take,
      }),
      this.prisma.supplierPayout.count({ where }),
    ]);

    // One batched lookup for the supplier names on this page, keyed by
    // the ids already in hand. A per-row query would be an N+1, and a
    // schema relation would be a migration.
    const companyIds = [
      ...new Set(rows.map((row) => row.orderAllocation.masterOrder.supplierCompanyId)),
    ];
    const companies = companyIds.length
      ? await this.prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, legalName: true },
        })
      : [];
    const legalNameById = new Map(companies.map((c) => [c.id, c.legalName]));

    return {
      items: rows.map((row) => ({
        id: row.id,
        orderAllocationId: row.orderAllocationId,
        masterOrderId: row.orderAllocation.masterOrderId,
        supplierCompanyId: row.orderAllocation.masterOrder.supplierCompanyId,
        supplierLegalName:
          legalNameById.get(row.orderAllocation.masterOrder.supplierCompanyId) ?? "",
        outcome: row.outcome as AdminSettlementItem["outcome"],
        netAmount: money(row.netAmount),
        currency: row.orderAllocation.masterOrder.paymentAttempt.currency,
        externalTransferReference: row.externalTransferReference,
        executedAt: row.executedAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }
}
