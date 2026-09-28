import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AdminOrderRow,
  AdminOrderStage,
  AdminOrderStageInsight,
  DashboardPeriod,
  Paginated,
} from "@platform/types";
import { PrismaService } from "../../database/prisma.service";
import { changePercent, resolvePeriod } from "./dashboard-period";
import { orderStage, RESOLVED_DISPUTE_STATUSES } from "./order-stage";

/**
 * The orders screen: the four stages, and the rows beneath them.
 *
 * THE STAGES ARE DERIVED, NOT STORED. `MasterOrderStatus` has two
 * values and the screen shows four, because "troubled" is not a
 * fulfilment status — an order can be perfectly in fulfilment and still
 * need an administrator. `order-stage.ts` holds that mapping alone, and
 * this service applies it.
 *
 * `paid` IS THE TOTAL. `master_orders` cannot be written without a
 * successful payment attempt, so every row in it is paid: there is no
 * unpaid order to count, and none to show. The other three stages
 * partition that same total exactly once each.
 *
 * ONE PASS FOR THE TROUBLED SET. The three conditions are answered by a
 * single query returning ids, not by a query per order — which is the
 * N+1 this screen would otherwise be made of.
 */
@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async insights(
    period: DashboardPeriod,
    now = new Date(),
  ): Promise<AdminOrderStageInsight> {
    const resolved = resolvePeriod(period, now);
    const { from, to } = resolved.current;

    const [totals, previousTotal, troubled, timings, payments] =
      await Promise.all([
        this.prisma.$queryRaw<{ total: bigint; fulfilled: bigint }[]>`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status = 'FULFILLED') AS fulfilled
        FROM master_orders
        WHERE created_at >= ${new Date(from)}::timestamptz
          AND created_at <  ${new Date(to)}::timestamptz
      `,
        resolved.previous
          ? this.prisma.masterOrder.count({
              where: {
                createdAt: {
                  gte: new Date(resolved.previous.from),
                  lt: new Date(resolved.previous.to),
                },
              },
            })
          : Promise.resolve(null),
        this.troubledIds(from, to),
        this.timings(from, to),
        this.paymentRate(from, to),
      ]);

    const paid = Number(totals[0]?.total ?? 0);
    const fulfilled = Number(totals[0]?.fulfilled ?? 0);
    const completed = fulfilled - troubled.fulfilled;
    const troubledCount = troubled.ids.size;

    return {
      paid,
      completed,
      troubled: troubledCount,
      inFulfilment: paid - completed - troubledCount,
      paymentSuccessRate: payments,
      averageStartHours: timings.startHours,
      averageCompletionDays: timings.completionDays,
      troubledRatePercent:
        paid === 0 ? null : Math.round((troubledCount / paid) * 1000) / 10,
      changePercent: changePercent(paid, previousTotal),
    };
  }

  async list(query: {
    period: DashboardPeriod;
    stage?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    now?: Date;
  }): Promise<Paginated<AdminOrderRow>> {
    const now = query.now ?? new Date();
    const { from, to } = resolvePeriod(query.period, now).current;

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const search = query.search?.trim();
    const where: Prisma.MasterOrderWhereInput = {
      createdAt: { gte: new Date(from), lt: new Date(to) },
      // The supplier is on the order as a snapshot; the buyer is on the
      // checkout session it came from. The reference an operator quotes
      // is the id, so a raw id also matches.
      ...(search
        ? {
            OR: [
              {
                supplierLegalNameSnapshot: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                checkoutSession: {
                  traderCompany: {
                    legalName: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    // THE TROUBLED SET FIRST, because filtering by stage needs it: an
    // order's stage cannot be expressed as a column predicate.
    const troubled = await this.troubledIds(from, to);

    const stageFilter = (query.stage ?? "") as AdminOrderStage | "";
    const stageWhere: Prisma.MasterOrderWhereInput =
      stageFilter === "troubled"
        ? { id: { in: [...troubled.ids] } }
        : stageFilter === "completed"
          ? { status: "FULFILLED", id: { notIn: [...troubled.ids] } }
          : stageFilter === "inFulfilment"
            ? { status: "IN_FULFILLMENT", id: { notIn: [...troubled.ids] } }
            : {};

    const predicate = { ...where, ...stageWhere };

    const [rows, total] = await Promise.all([
      this.prisma.masterOrder.findMany({
        where: predicate,
        select: {
          id: true,
          status: true,
          totalAmount: true,
          paidAt: true,
          createdAt: true,
          traderCompanyId: true,
          supplierCompanyId: true,
          supplierLegalNameSnapshot: true,
          checkoutSession: {
            select: { traderCompany: { select: { legalName: true } } },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.masterOrder.count({ where: predicate }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        // The reference an operator quotes. The platform has no separate
        // order number column, so the id's first segment is used —
        // short enough to read, and unique.
        reference: `ORD-${row.id.slice(0, 8).toUpperCase()}`,
        buyerCompanyId: row.traderCompanyId,
        buyerName: row.checkoutSession?.traderCompany?.legalName ?? "—",
        supplierCompanyId: row.supplierCompanyId,
        supplierName: row.supplierLegalNameSnapshot,
        totalAmount: row.totalAmount.toString(),
        stage: orderStage({
          status: row.status,
          hasOpenDispute: troubled.ids.has(row.id),
          hasFailedRefund: false,
          hasOverduePreparation: false,
        }),
        // EVERY ROW IS PAID, by construction. Carried so the column says
        // something true rather than being left to an assumption.
        paid: true,
        paidAt: row.paidAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Every order in the window that needs an administrator.
   *
   * The three conditions in one query: an unresolved dispute, a refund
   * that failed for good, or an allocation still unprepared past the
   * deadline the fulfilment flow itself wrote.
   */
  private async troubledIds(from: string, to: string) {
    // TWO THINGS THIS QUERY GETS RIGHT THE HARD WAY.
    //
    // `d.status::text` — `disputes.status` is a PostgreSQL enum and
    // `Prisma.join` binds its values as TEXT parameters. There is no
    // implicit operator between the two, so without the cast this fails
    // at run time with "operator does not exist: DisputeStatus <> text".
    // A literal written into the SQL would be coerced; a bound parameter
    // is not. Neither TypeScript nor the build sees the difference.
    //
    // `ro.payment_attempt_id = o.payment_attempt_id` — a refund hangs
    // off the PAYMENT, not the allocation. `refund_obligations` has no
    // `order_allocation_id` column at all.
    const rows = await this.prisma.$queryRaw<{ id: string; status: string }[]>`
      SELECT DISTINCT o.id, o.status
      FROM master_orders o
      LEFT JOIN order_allocations a ON a.master_order_id = o.id
      LEFT JOIN disputes d ON d.order_allocation_id = a.id
        -- The cast is required; see the note above this query.
        AND d.status::text NOT IN (${Prisma.join(RESOLVED_DISPUTE_STATUSES)})
      LEFT JOIN refund_obligations ro ON ro.payment_attempt_id = o.payment_attempt_id
      LEFT JOIN refund_attempts ra ON ra.refund_obligation_id = ro.id
        AND ra.status = 'DEFINITIVE_FAILED'
      WHERE o.created_at >= ${new Date(from)}::timestamptz
        AND o.created_at <  ${new Date(to)}::timestamptz
        AND (
          d.id IS NOT NULL
          OR ra.id IS NOT NULL
          OR (a.status = 'AWAITING_PREPARATION' AND a.preparation_due_at < now())
        )
    `;

    return {
      ids: new Set(rows.map((row) => row.id)),
      fulfilled: rows.filter((row) => row.status === "FULFILLED").length,
    };
  }

  /** How long orders take to start, and to finish. */
  private async timings(from: string, to: string) {
    const rows = await this.prisma.$queryRaw<
      { start_hours: number | null; completion_days: number | null }[]
    >`
      SELECT
        AVG(EXTRACT(EPOCH FROM (a.preparation_started_at - o.paid_at)) / 3600)
          FILTER (WHERE a.preparation_started_at IS NOT NULL)      AS start_hours,
        AVG(EXTRACT(EPOCH FROM (a.delivered_at - o.paid_at)) / 86400)
          FILTER (WHERE a.delivered_at IS NOT NULL)                AS completion_days
      FROM master_orders o
      JOIN order_allocations a ON a.master_order_id = o.id
      WHERE o.created_at >= ${new Date(from)}::timestamptz
        AND o.created_at <  ${new Date(to)}::timestamptz
    `;

    const row = rows[0];
    return {
      startHours:
        row?.start_hours === null ? null : round1(Number(row?.start_hours)),
      completionDays:
        row?.completion_days === null
          ? null
          : round1(Number(row?.completion_days)),
    };
  }

  private async paymentRate(from: string, to: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<
      { succeeded: bigint; resolved: bigint }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SUCCEEDED') AS succeeded,
        COUNT(*) FILTER (WHERE status IN ('SUCCEEDED', 'FAILED')) AS resolved
      FROM payment_attempts
      WHERE created_at >= ${new Date(from)}::timestamptz
        AND created_at <  ${new Date(to)}::timestamptz
    `;

    const resolved = Number(rows[0]?.resolved ?? 0);
    if (resolved === 0) return null;
    return Math.round((Number(rows[0]?.succeeded ?? 0) / resolved) * 1000) / 10;
  }
}

function round1(value: number): number | null {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}
