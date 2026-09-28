import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  DashboardAttentionRow,
  DashboardGrowthPoint,
  DashboardMoneyMetric,
  DashboardOverview,
  DashboardPeriod,
  DashboardRange,
  DashboardSeriesPoint,
} from "@platform/types";
import { PLATFORM_OWNED_LISTING_BLOCKERS } from "@platform/types";
import { PrismaService } from "../../database/prisma.service";
import {
  bucketSeconds,
  bucketsFor,
  changePercent,
  resolvePeriod,
} from "./dashboard-period";
import { RESOLVED_DISPUTE_STATUSES } from "./order-stage";

/**
 * Everything the overview screen shows, in one read.
 *
 * ONE ENDPOINT, NOT TWENTY. The screen this replaces called six list
 * endpoints and counted their lengths — which made "how many suppliers
 * are waiting" a number that depended on a page size. Here each figure
 * is a database aggregate, and the independent ones run at once.
 *
 * NOTHING IS RECOMPUTED. `commission_amount`, `supplier_payable_amount`
 * and `total_amount` are columns the payment flow wrote when the order
 * was created; this sums them. No commission rate is applied here, no
 * tax is derived, and no order status is changed.
 *
 * MONEY LEAVES AS A STRING. `Decimal(14,2)` does not survive a
 * JavaScript number, and a total that rounds on its way to a screen is
 * a total nobody can reconcile against the ledger.
 */

/** Repeated failures worth an administrator's attention. */
const REPEATED_FAILURE_THRESHOLD = 3;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(
    period: DashboardPeriod,
    now = new Date(),
  ): Promise<DashboardOverview> {
    const resolved = resolvePeriod(period, now);
    const current = resolved.current;
    const previous = resolved.previous;

    // INDEPENDENT READS, TOGETHER. Every one of these touches a
    // different table or a different window; running them in sequence
    // would make the page as slow as their sum for no reason.
    const [
      orders,
      previousOrders,
      refunded,
      previousRefunded,
      payments,
      previousPayments,
      opportunities,
      previousOpportunities,
      endingSoon,
      pendingSettlements,
      troubledIds,
      attention,
      series,
      growth,
    ] = await Promise.all([
      this.orderTotals(current),
      previous ? this.orderTotals(previous) : Promise.resolve(null),
      this.refundedTotal(current),
      previous ? this.refundedTotal(previous) : Promise.resolve(null),
      this.paymentOutcome(current),
      previous ? this.paymentOutcome(previous) : Promise.resolve(null),
      this.opportunityCount(current),
      previous ? this.opportunityCount(previous) : Promise.resolve(null),
      this.opportunitiesEndingSoon(now),
      this.pendingSettlementCount(),
      this.troubledOrderIds(current),
      this.attention(now),
      this.financialSeries(current, resolved.granularity),
      this.growth(current, resolved.granularity),
    ]);

    const paidCount = orders.count;
    const troubled = troubledIds.size;
    // EXCLUSIVE, AND THEY SUM TO THE TOTAL: troubled first, then the
    // fulfilment status decides the rest.
    const completed = orders.fulfilled - troubledIds.fulfilled;
    const inFulfilment = paidCount - completed - troubled;

    return {
      period,
      range: current,
      previousRange: previous,
      generatedAt: now.toISOString(),

      financials: {
        paidOrders: money(orders.total, previousOrders?.total ?? null),
        paidOrderCount: paidCount,
        platformRevenue: money(
          orders.commission,
          previousOrders?.commission ?? null,
        ),
        averageCommissionBasisPoints: orders.averageBasisPoints,
        supplierPayable: money(orders.payable, previousOrders?.payable ?? null),
        pendingSettlements,
        refunded: money(refunded, previousRefunded),
        refundRatePercent: ratio(refunded, orders.total),
      },

      operations: {
        paymentSuccessRate: {
          value: payments.rate,
          previous: previousPayments?.rate ?? null,
        },
        activeOpportunities: count(opportunities, previousOpportunities),
        endingSoon,
        activeSuppliers: count(
          orders.suppliers,
          previousOrders?.suppliers ?? null,
        ),
        activeBuyers: count(orders.buyers, previousOrders?.buyers ?? null),
      },

      series,
      growth,
      orders: { paid: paidCount, inFulfilment, completed, troubled },
      attention,
    };
  }

  // ----- money -------------------------------------------------------

  /**
   * The three sums, the two distinct-company counts, and the weighted
   * commission — from ONE pass over the period's orders.
   *
   * `$queryRaw` rather than five `aggregate` calls: they would each scan
   * the same rows, and `COUNT(DISTINCT …)` has no Prisma equivalent.
   * The numbers arrive as text and stay text.
   */
  private async orderTotals(range: DashboardRange) {
    const rows = await this.prisma.$queryRaw<
      {
        total: string | null;
        commission: string | null;
        payable: string | null;
        commission_base: string | null;
        weighted_bps: string | null;
        order_count: bigint;
        fulfilled: bigint;
        buyers: bigint;
        suppliers: bigint;
      }[]
    >`
      SELECT
        SUM(total_amount)::text              AS total,
        SUM(commission_amount)::text         AS commission,
        SUM(supplier_payable_amount)::text   AS payable,
        SUM(commission_base)::text           AS commission_base,
        SUM(commission_base * commission_rate_basis_points)::text AS weighted_bps,
        COUNT(*)                             AS order_count,
        COUNT(*) FILTER (WHERE status = 'FULFILLED') AS fulfilled,
        COUNT(DISTINCT trader_company_id)    AS buyers,
        COUNT(DISTINCT supplier_company_id)  AS suppliers
      FROM master_orders
      WHERE created_at >= ${new Date(range.from)}::timestamptz
        AND created_at <  ${new Date(range.to)}::timestamptz
    `;

    const row = rows[0];
    const base = row?.commission_base
      ? new Prisma.Decimal(row.commission_base)
      : null;
    const weighted = row?.weighted_bps
      ? new Prisma.Decimal(row.weighted_bps)
      : null;

    return {
      total: row?.total ?? "0.00",
      commission: row?.commission ?? "0.00",
      payable: row?.payable ?? "0.00",
      count: Number(row?.order_count ?? 0),
      fulfilled: Number(row?.fulfilled ?? 0),
      buyers: Number(row?.buyers ?? 0),
      suppliers: Number(row?.suppliers ?? 0),
      // WEIGHTED BY VALUE, not a mean of rates: a hundred small orders
      // at one rate and one large order at another do not average to
      // the midpoint of the two rates.
      averageBasisPoints:
        base && weighted && !base.isZero()
          ? Math.round(weighted.div(base).toNumber())
          : null,
    };
  }

  /** Money that actually left, not obligations raised. */
  private async refundedTotal(range: DashboardRange): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(o.amount)::text AS total
      FROM refund_attempts a
      JOIN refund_obligations o ON o.id = a.refund_obligation_id
      WHERE a.status = 'SUCCEEDED'
        AND a.created_at >= ${new Date(range.from)}::timestamptz
        AND a.created_at <  ${new Date(range.to)}::timestamptz
    `;
    return rows[0]?.total ?? "0.00";
  }

  // ----- operations --------------------------------------------------

  /**
   * Successful payments over the attempts that RESOLVED.
   *
   * `CREATED` and `PENDING` have not failed; `SUPERSEDED` and `EXPIRED`
   * were never a chance to pay. Counting them would make the rate fall
   * whenever somebody left a checkout open.
   */
  private async paymentOutcome(range: DashboardRange) {
    const rows = await this.prisma.$queryRaw<
      { succeeded: bigint; resolved: bigint }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SUCCEEDED') AS succeeded,
        COUNT(*) FILTER (WHERE status IN ('SUCCEEDED', 'FAILED')) AS resolved
      FROM payment_attempts
      WHERE created_at >= ${new Date(range.from)}::timestamptz
        AND created_at <  ${new Date(range.to)}::timestamptz
    `;

    const succeeded = Number(rows[0]?.succeeded ?? 0);
    const resolved = Number(rows[0]?.resolved ?? 0);

    return {
      // ZERO ATTEMPTS IS NOT ZERO PER CENT. It is no rate at all.
      rate:
        resolved === 0 ? null : Math.round((succeeded / resolved) * 1000) / 10,
    };
  }

  private opportunityCount(range: DashboardRange) {
    return this.prisma.opportunity.count({
      where: {
        status: "ACTIVE",
        createdAt: { gte: new Date(range.from), lt: new Date(range.to) },
      },
    });
  }

  private opportunitiesEndingSoon(now: Date) {
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return this.prisma.opportunity.count({
      // `endAt` is when an opportunity stops accepting orders.
      where: { status: "ACTIVE", endAt: { gte: now, lt: soon } },
    });
  }

  private pendingSettlementCount() {
    return this.prisma.orderAllocation.count({
      where: { deliveredAt: { not: null }, payoutSettledAt: null },
    });
  }

  // ----- the troubled set --------------------------------------------

  /**
   * Which orders in the period need an administrator, and how many of
   * those are already fulfilled.
   *
   * The second number is what keeps the four stages from double
   * counting: a fulfilled order that is also disputed must be removed
   * from "completed" before it is added to "troubled".
   */
  private async troubledOrderIds(range: DashboardRange) {
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
      WHERE o.created_at >= ${new Date(range.from)}::timestamptz
        AND o.created_at <  ${new Date(range.to)}::timestamptz
        AND (
          d.id IS NOT NULL
          OR ra.id IS NOT NULL
          -- The deadline the fulfilment flow itself wrote, still unmet.
          OR (a.status = 'AWAITING_PREPARATION' AND a.preparation_due_at < now())
        )
    `;

    const ids = new Set(rows.map((row) => row.id));
    return {
      size: ids.size,
      fulfilled: rows.filter((row) => row.status === "FULFILLED").length,
      ids,
    };
  }

  // ----- charts ------------------------------------------------------

  private async financialSeries(
    range: DashboardRange,
    granularity: "daily" | "weekly",
  ) {
    const buckets = bucketsFor(range, granularity);
    const from = new Date(range.from);
    const step = bucketSeconds(granularity);

    // GROUPED BY THE BUCKET'S INDEX, counted from the window's own
    // start. `date_trunc('week', …)` returns a MONDAY, and the array
    // above starts wherever the window starts — a Thursday for the
    // 90-day window — so the two key spaces never met and every real
    // order fell outside the chart. Dividing the elapsed seconds by the
    // bucket length is the same arithmetic the array performs, so a row
    // lands in exactly the bucket that contains it.
    const rows = await this.prisma.$queryRaw<
      { bucket_index: number; total: string; commission: string }[]
    >`
      SELECT
        FLOOR(EXTRACT(EPOCH FROM (created_at - ${from}::timestamptz)) / ${step})::int AS bucket_index,
        SUM(total_amount)::text      AS total,
        SUM(commission_amount)::text AS commission
      FROM master_orders
      WHERE created_at >= ${from}::timestamptz
        AND created_at <  ${new Date(range.to)}::timestamptz
      GROUP BY 1
      ORDER BY 1
    `;

    const byBucket = new Map(
      rows.map((row) => [Number(row.bucket_index), row]),
    );

    // THE BUCKETS COME FROM THE RANGE, not from the rows: a week with
    // no orders must be a zero on the line, not a week that vanished.
    const paidOrders: DashboardSeriesPoint[] = [];
    const platformRevenue: DashboardSeriesPoint[] = [];

    buckets.forEach((at, index) => {
      const row = byBucket.get(index);
      const label = String(index + 1);
      paidOrders.push({
        at: at.toISOString(),
        label,
        value: row?.total ?? "0.00",
      });
      platformRevenue.push({
        at: at.toISOString(),
        label,
        value: row?.commission ?? "0.00",
      });
    });

    return { granularity, paidOrders, platformRevenue };
  }

  /** NEW REGISTRATIONS per bucket, never a running total. */
  private async growth(
    range: DashboardRange,
    granularity: "daily" | "weekly",
  ): Promise<DashboardGrowthPoint[]> {
    const buckets = bucketsFor(range, granularity);
    const from = new Date(range.from);
    const step = bucketSeconds(granularity);

    // Indexed from the window's start, for the reason spelled out in
    // `financialSeries` — this chart lost its columns the same way.
    const rows = await this.prisma.$queryRaw<
      { bucket_index: number; account_type: string; total: bigint }[]
    >`
      SELECT
        FLOOR(EXTRACT(EPOCH FROM (created_at - ${from}::timestamptz)) / ${step})::int AS bucket_index,
        account_type,
        COUNT(*) AS total
      FROM companies
      WHERE created_at >= ${from}::timestamptz
        AND created_at <  ${new Date(range.to)}::timestamptz
      GROUP BY 1, 2
      ORDER BY 1
    `;

    const key = (index: number, type: string) => `${index}:${type}`;
    const byKey = new Map(
      rows.map((row) => [
        key(Number(row.bucket_index), row.account_type),
        Number(row.total),
      ]),
    );

    return buckets.map((at, index) => ({
      at: at.toISOString(),
      label: String(index + 1),
      buyers: byKey.get(key(index, "TRADER")) ?? 0,
      suppliers: byKey.get(key(index, "SUPPLIER")) ?? 0,
    }));
  }

  // ----- needs attention ---------------------------------------------

  /**
   * The operational cases waiting on somebody, by kind.
   *
   * Counted from the SAME predicates the follow-up centre lists by, so
   * "8 suppliers awaiting verification" on this screen and the eight
   * rows on that one cannot disagree.
   */
  private async attention(now: Date): Promise<DashboardAttentionRow[]> {
    const [
      settlements,
      payments,
      disputes,
      bankAccounts,
      suppliers,
      blockedListings,
    ] = await Promise.all([
        this.prisma.orderAllocation.findMany({
          where: { deliveredAt: { not: null }, payoutSettledAt: null },
          select: { deliveredAt: true },
          orderBy: { deliveredAt: "asc" },
        }),
        this.repeatedPaymentFailures(),
        this.prisma.dispute.findMany({
          where: { status: { notIn: [...RESOLVED_DISPUTE_STATUSES] as never } },
          select: { openedAt: true },
          orderBy: { openedAt: "asc" },
        }),
        this.prisma.supplierBankAccount.findMany({
          where: { verificationStatus: "PENDING_VERIFICATION" as never },
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.company.findMany({
          where: {
            accountType: "SUPPLIER",
            verificationStatus: "PENDING_VERIFICATION",
          },
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
        }),
        // LISTINGS BLOCKED BY SOMETHING ONLY THIS CONSOLE CAN FIX.
        //
        // This slot used to hold a count of products in PENDING_REVIEW
        // — a query that survived the removal of the approval queue
        // because its RESULT was dropped from the destructuring while
        // the query itself stayed in the array. It ran on every load of
        // this screen, against a state nothing can be in.
        //
        // What replaces it is the case that was actually missing.
        // ACTION_REQUIRED is where a live listing lands when it stops
        // being publishable, and its reason code says whose problem it
        // is. Only the two the platform owns are counted: a city
        // switched off in reference data, and a tax rate never
        // configured. Reasons the supplier owns are theirs; the two the
        // platform owns that already have a queue are counted there and
        // not twice; and a product this console suspended or closed is
        // a decision already taken, not work waiting.
        //
        // `blockedAt`, not `updatedAt`: the age of the block is the
        // number an operator needs, and any later edit to the row would
        // reset the other one.
        this.prisma.opportunity.findMany({
          where: {
            status: "ACTION_REQUIRED",
            reasonCode: { in: [...PLATFORM_OWNED_LISTING_BLOCKERS] },
          },
          select: { blockedAt: true },
          orderBy: { blockedAt: "asc" },
        }),
      ]);

    const age = (at: Date | null | undefined) =>
      at ? Math.floor((now.getTime() - at.getTime()) / (60 * 60 * 1000)) : null;

    return [
      {
        kind: "SETTLEMENT_OVERDUE" as const,
        count: settlements.length,
        priority: "CRITICAL" as const,
        oldestAgeHours: age(settlements[0]?.deliveredAt),
        href: "/admin/settlements",
      },
      {
        kind: "PAYMENT_REPEATEDLY_FAILED" as const,
        count: payments.count,
        priority: "CRITICAL" as const,
        oldestAgeHours: age(payments.oldest),
        href: "/admin/orders?stage=troubled",
      },
      {
        kind: "DISPUTE_OPEN" as const,
        count: disputes.length,
        priority: "OVERDUE" as const,
        oldestAgeHours: age(disputes[0]?.openedAt),
        href: "/admin/disputes",
      },
      {
        kind: "BANK_ACCOUNT_REVIEW" as const,
        count: bankAccounts.length,
        priority: "REVIEW" as const,
        oldestAgeHours: age(bankAccounts[0]?.createdAt),
        href: "/admin/bank-accounts",
      },
      {
        kind: "SUPPLIER_VERIFICATION" as const,
        count: suppliers.length,
        priority: "REVIEW" as const,
        oldestAgeHours: age(suppliers[0]?.createdAt),
        href: "/admin/companies?accountType=SUPPLIER&verificationStatus=PENDING_VERIFICATION",
      },
      {
        kind: "LISTING_BLOCKED_BY_PLATFORM" as const,
        count: blockedListings.length,
        // REVIEW, not CRITICAL. Nobody is owed money and no deadline is
        // running; what is happening is that listings are off the market
        // for a reason a supplier cannot see or fix.
        priority: "REVIEW" as const,
        oldestAgeHours: age(blockedListings[0]?.blockedAt),
        href: "/admin/opportunities?status=ACTION_REQUIRED",
      },
      // NO PRODUCT REVIEW ROW. A supplier publishes directly, so nothing
      // can enter PENDING_REVIEW and the query behind this row could only
      // ever return the empty set — while its link sent an operator to a
      // filter guaranteed to show nothing. The enum value and the stored
      // `approvalStatus` are left alone; only the case is gone.
      //
      // A kind with nothing waiting is dropped: a row reading "0" is a
      // line an operator has to read to learn there is nothing to do.
    ].filter((row) => row.count > 0);
  }

  /** Checkout sessions whose payment failed more than once. */
  private async repeatedPaymentFailures() {
    const rows = await this.prisma.$queryRaw<
      { oldest: Date | null; total: bigint }[]
    >`
      SELECT MIN(first_failure) AS oldest, COUNT(*) AS total
      FROM (
        SELECT checkout_session_id, MIN(created_at) AS first_failure
        FROM payment_attempts
        WHERE status = 'FAILED'
        GROUP BY checkout_session_id
        HAVING COUNT(*) >= ${REPEATED_FAILURE_THRESHOLD}
      ) repeated
    `;

    return {
      count: Number(rows[0]?.total ?? 0),
      oldest: rows[0]?.oldest ?? null,
    };
  }
}

// ----- shaping -------------------------------------------------------

function money(value: string, previous: string | null): DashboardMoneyMetric {
  return {
    value,
    previous,
    // The percentage is computed on numbers because a PERCENTAGE has no
    // need of two decimal places; the amounts themselves stay strings.
    changePercent: changePercent(
      Number(value),
      previous === null ? null : Number(previous),
    ),
  };
}

function count(value: number, previous: number | null) {
  return { value, previous, changePercent: changePercent(value, previous) };
}

/** A share of a decimal total, or null when the total was nothing. */
function ratio(part: string, whole: string): number | null {
  const total = Number(whole);
  if (!Number.isFinite(total) || total === 0) return null;
  return Math.round((Number(part) / total) * 1000) / 10;
}
