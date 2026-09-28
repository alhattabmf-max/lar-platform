import { Injectable } from "@nestjs/common";
import type {
  DashboardPeriod,
  DashboardRange,
  OrderAllocationStatus,
  SupplierDashboardListing,
  SupplierDashboardOverview,
  SupplierFulfilmentCounts,
  SupplierSeriesPoint,
} from "@platform/types";
import { ORDER_ALLOCATION_STATUSES } from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import {
  bucketSeconds,
  bucketsFor,
  changePercent,
  resolvePeriod,
} from "../admin/dashboard/dashboard-period";
import { selectMainMedia } from "../opportunities/snapshot-media.util";

/**
 * THE SUPPLIER'S OWN LANDING SCREEN, computed once.
 *
 * WHAT IT REPLACES. The page assembled itself from six list endpoints
 * and counted the rows that came back — which answers "how many are on
 * the first page", not "how many are there". A supplier with 60 orders
 * awaiting preparation was shown however many fitted in a page.
 *
 * IT REUSES THE CONSOLE'S ARITHMETIC, deliberately. The same columns,
 * the same windows, the same rule about what counts as paid — narrowed
 * by `supplier_company_id` and nothing else. Two definitions of "paid
 * orders" is how a supplier's screen comes to disagree with an
 * administrator's about the same week.
 *
 * NOTHING IS DERIVED THAT THE DATABASE DID NOT ALREADY WRITE. No
 * commission is recalculated, no payable is re-derived, no trend is
 * smoothed or extrapolated. Where a figure genuinely does not exist —
 * a first month with no predecessor, a company with no transfer yet —
 * this returns null and the screen says so.
 */
@Injectable()
export class SupplierDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(
    companyId: string,
    period: DashboardPeriod,
    now = new Date(),
  ): Promise<SupplierDashboardOverview> {
    const resolved = resolvePeriod(period, now);

    // ONE ROUND OF PARALLEL READS. Each is independent; awaiting them
    // in sequence would make the page as slow as their sum for no
    // reason at all.
    const [
      orders,
      previousOrders,
      unsettled,
      newBuyers,
      opportunities,
      endingSoon,
      series,
      refunded,
      listings,
      transferred,
      lastTransfer,
      fulfilment,
      attention,
    ] = await Promise.all([
      this.orderTotals(companyId, resolved.current),
      resolved.previous
        ? this.orderTotals(companyId, resolved.previous)
        : Promise.resolve(null),
      this.unsettledPayable(companyId),
      this.newBuyerCount(companyId, resolved.current),
      this.activeOpportunityCount(companyId, now),
      this.opportunitiesEndingSoon(companyId, now),
      this.paidSeries(companyId, resolved.current, resolved.granularity),
      this.refundedTotal(companyId, resolved.current),
      this.currentListings(companyId, now),
      this.transferredInPeriod(companyId, resolved.current),
      this.lastTransfer(companyId),
      this.fulfilmentCounts(companyId),
      this.attention(companyId),
    ]);

    const money = (value: string, previous: string | null) => ({
      value,
      previous,
      changePercent: changePercent(
        Number(value),
        previous === null ? null : Number(previous),
      ),
    });

    return {
      period,
      range: resolved.current,
      generatedAt: now.toISOString(),
      cards: {
        paidOrders: money(orders.total, previousOrders?.total ?? null),
        unsettledPayable: unsettled,
        buyers: {
          value: orders.buyers,
          previous: previousOrders?.buyers ?? null,
          changePercent: changePercent(
            orders.buyers,
            previousOrders?.buyers ?? null,
          ),
        },
        newBuyers,
        activeOpportunities: opportunities,
        opportunitiesEndingSoon: endingSoon,
      },
      series: {
        granularity: resolved.granularity,
        paidOrders: series,
        refunded,
      },
      listings,
      settlements: { transferredInPeriod: transferred, lastTransfer },
      fulfilment,
      attention,
    };
  }

  // ------------------------------------------------------- the money

  /**
   * What buyers paid for THIS supplier's orders, and how many bought.
   *
   * `total_amount` is the same column the console sums for its own
   * «قيمة الطلبات المدفوعة» card; the only difference is the WHERE.
   */
  private async orderTotals(companyId: string, range: DashboardRange) {
    const rows = await this.prisma.$queryRaw<
      { total: string | null; buyers: bigint }[]
    >`
      SELECT
        SUM(total_amount)::text           AS total,
        COUNT(DISTINCT trader_company_id) AS buyers
      FROM master_orders
      WHERE supplier_company_id = ${companyId}::uuid
        AND created_at >= ${new Date(range.from)}::timestamptz
        AND created_at <  ${new Date(range.to)}::timestamptz
    `;
    return {
      total: rows[0]?.total ?? "0.00",
      buyers: Number(rows[0]?.buyers ?? 0),
    };
  }

  /**
   * DELIVERED AND NOT YET TRANSFERRED.
   *
   * The same pair of conditions the console counts by — delivered, no
   * payout — summed over the allocation's OWN share.
   *
   * THE SHARE IS ON THE FINANCIAL SNAPSHOT, not on the allocation and
   * not on the order: `master_orders.supplier_payable_amount` is the
   * whole order's payable, and an order can be split across several
   * allocations that settle at different times. Summing the order's
   * figure would count the same money once per allocation.
   *
   * An order still in a warehouse is not money anybody is waiting for,
   * so it is not in here.
   */
  private async unsettledPayable(companyId: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(s.supplier_payable_share_amount)::text AS total
      FROM order_allocations a
      JOIN master_orders o ON o.id = a.master_order_id
      JOIN order_allocation_financial_snapshots s
        ON s.order_allocation_id = a.id
      WHERE o.supplier_company_id = ${companyId}::uuid
        AND a.delivered_at IS NOT NULL
        AND a.payout_settled_at IS NULL
    `;
    return rows[0]?.total ?? "0.00";
  }

  /**
   * Buyers whose FIRST order from this supplier falls in the window.
   *
   * NOT "buyers who are new to the platform" — a company that has
   * bought elsewhere for a year is still a new customer to THIS
   * supplier, and that is the number a supplier acts on.
   */
  private async newBuyerCount(
    companyId: string,
    range: DashboardRange,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM (
        SELECT trader_company_id, MIN(created_at) AS first_order
        FROM master_orders
        WHERE supplier_company_id = ${companyId}::uuid
        GROUP BY trader_company_id
      ) firsts
      WHERE first_order >= ${new Date(range.from)}::timestamptz
        AND first_order <  ${new Date(range.to)}::timestamptz
    `;
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Money that actually went back to buyers, on this supplier's orders.
   *
   * REACHED THROUGH THE PAYMENT ATTEMPT, because that is what a refund
   * obligation names — a refund is raised against the payment, not
   * against one allocation of the order it paid for. `master_orders`
   * carries the same attempt id, which is the join that scopes this to
   * one supplier.
   */
  private async refundedTotal(
    companyId: string,
    range: DashboardRange,
  ): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(o.amount)::text AS total
      FROM refund_attempts a
      JOIN refund_obligations o ON o.id = a.refund_obligation_id
      JOIN master_orders m ON m.payment_attempt_id = o.payment_attempt_id
      WHERE m.supplier_company_id = ${companyId}::uuid
        AND a.status = 'SUCCEEDED'
        AND a.created_at >= ${new Date(range.from)}::timestamptz
        AND a.created_at <  ${new Date(range.to)}::timestamptz
    `;
    return rows[0]?.total ?? "0.00";
  }

  /**
   * The sales line.
   *
   * BUCKETED BY THE WINDOW'S OWN START, not by `date_trunc`: the array
   * of buckets starts wherever the window starts, and `date_trunc`
   * would return a Monday. Dividing elapsed seconds by the bucket
   * length is the same arithmetic the array performs, so a row lands
   * in exactly the bucket that contains it.
   *
   * THE BUCKETS COME FROM THE RANGE, never from the rows: a week with
   * no orders is a zero on the line, not a week that vanished.
   */
  private async paidSeries(
    companyId: string,
    range: DashboardRange,
    granularity: "daily" | "weekly",
  ): Promise<SupplierSeriesPoint[]> {
    const buckets = bucketsFor(range, granularity);
    const from = new Date(range.from);
    const step = bucketSeconds(granularity);

    const rows = await this.prisma.$queryRaw<
      { bucket_index: number; total: string }[]
    >`
      SELECT
        FLOOR(EXTRACT(EPOCH FROM (created_at - ${from}::timestamptz)) / ${step})::int AS bucket_index,
        SUM(total_amount)::text AS total
      FROM master_orders
      WHERE supplier_company_id = ${companyId}::uuid
        AND created_at >= ${from}::timestamptz
        AND created_at <  ${new Date(range.to)}::timestamptz
      GROUP BY 1
      ORDER BY 1
    `;

    const byBucket = new Map(rows.map((r) => [Number(r.bucket_index), r]));
    return buckets.map((at, index) => ({
      at: at.toISOString(),
      label: String(index + 1),
      value: byBucket.get(index)?.total ?? "0.00",
    }));
  }

  // ------------------------------------------------- the settlements

  /**
   * MONEY THAT ACTUALLY MOVED.
   *
   * `EXECUTED` only — the platform's other outcome, `ZERO_BALANCE`, is
   * a settlement that resolved to nothing. Counting it would put rows
   * in «تم تحويله» that transferred no money, and «آخر تحويل» would
   * report a date on which a supplier was paid zero.
   */
  private async transferredInPeriod(
    companyId: string,
    range: DashboardRange,
  ): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(p.net_amount)::text AS total
      FROM supplier_payouts p
      JOIN order_allocations a ON a.id = p.order_allocation_id
      JOIN master_orders m ON m.id = a.master_order_id
      WHERE m.supplier_company_id = ${companyId}::uuid
        AND p.outcome = 'EXECUTED'
        AND p.executed_at >= ${new Date(range.from)}::timestamptz
        AND p.executed_at <  ${new Date(range.to)}::timestamptz
    `;
    return rows[0]?.total ?? "0.00";
  }

  /**
   * The most recent transfer, whenever it was.
   *
   * DELIBERATELY NOT BOUNDED BY THE WINDOW: «آخر تحويل» answers "when
   * was I last paid", and a supplier who was paid five weeks ago needs
   * that answer more than a supplier who was paid yesterday.
   */
  private async lastTransfer(companyId: string) {
    const rows = await this.prisma.$queryRaw<
      { amount: string; executed_at: Date }[]
    >`
      SELECT p.net_amount::text AS amount, p.executed_at
      FROM supplier_payouts p
      JOIN order_allocations a ON a.id = p.order_allocation_id
      JOIN master_orders m ON m.id = a.master_order_id
      WHERE m.supplier_company_id = ${companyId}::uuid
        AND p.outcome = 'EXECUTED'
      ORDER BY p.executed_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    return row
      ? { amount: row.amount, at: row.executed_at.toISOString() }
      : null;
  }

  // -------------------------------------------------- the operations

  /**
   * One count per allocation status, with every status present.
   *
   * A STATUS WITH NO ROWS IS A ZERO, not a missing key: the screen
   * draws five tiles whatever the data, and a stage that vanished
   * would read as a stage the platform does not have.
   */
  private async fulfilmentCounts(
    companyId: string,
  ): Promise<SupplierFulfilmentCounts> {
    const rows = await this.prisma.$queryRaw<
      { status: OrderAllocationStatus; count: bigint }[]
    >`
      SELECT a.status, COUNT(*) AS count
      FROM order_allocations a
      JOIN master_orders m ON m.id = a.master_order_id
      WHERE m.supplier_company_id = ${companyId}::uuid
      GROUP BY a.status
    `;
    const byStatus = new Map(rows.map((r) => [r.status, Number(r.count)]));
    return Object.fromEntries(
      ORDER_ALLOCATION_STATUSES.map((status) => [
        status,
        byStatus.get(status) ?? 0,
      ]),
    ) as SupplierFulfilmentCounts;
  }

  /** What is waiting for this supplier to act, as three counts. */
  private async attention(companyId: string) {
    const [orders, disputes, replacements] = await Promise.all([
      this.prisma.orderAllocation.count({
        where: {
          status: "AWAITING_PREPARATION",
          masterOrder: { supplierCompanyId: companyId },
        },
      }),
      // OPEN is the one state waiting on the SUPPLIER. Every other
      // state is waiting on a buyer, an administrator, or nobody.
      this.prisma.dispute.count({
        where: {
          status: "OPEN",
          orderAllocation: { masterOrder: { supplierCompanyId: companyId } },
        },
      }),
      this.prisma.replacementObligation.count({
        where: {
          status: { in: ["AWAITING_PREPARATION", "PREPARING"] },
          originalOrderAllocation: {
            masterOrder: { supplierCompanyId: companyId },
          },
        },
      }),
    ]);
    return {
      ordersAwaitingPreparation: orders,
      disputesAwaitingResponse: disputes,
      replacementsAwaitingAction: replacements,
    };
  }

  // ---------------------------------------------------- the listings

  /**
   * A LISTING THAT IS ACTUALLY SELLING: ACTIVE, and not yet closed.
   *
   * `ACTIVE` is the platform's word — there is no `PUBLISHED`. A
   * SCHEDULED listing has not opened, a PAUSED one is not taking
   * orders, and FUNDED, EXPIRED and CANCELLED are all over.
   */
  /**
   * WHAT IS ON SALE RIGHT NOW.
   *
   * A GROUP offer is on sale while it is ACTIVE and its window has not
   * closed. A DIRECT listing is on sale while it is ACTIVE, full stop:
   * it has no window, and `end_at` is NULL on it — which `endAt: { gt:
   * now }` would have read as "not greater than now" and excluded every
   * direct listing from the supplier's own home screen.
   */
  private opportunityWhere(companyId: string, now: Date) {
    return {
      companyId,
      status: "ACTIVE" as const,
      OR: [{ endAt: { gt: now } }, { endAt: null }],
    };
  }

  private activeOpportunityCount(companyId: string, now: Date) {
    return this.prisma.opportunity.count({
      where: this.opportunityWhere(companyId, now),
    });
  }

  /**
   * Active and closing within seven days — the number worth acting on.
   *
   * GROUP ONLY, and not by a filter that has to be remembered: nothing
   * without a window can be closing, and `endAt` is NULL on every
   * direct listing, so the range below excludes them by arithmetic.
   * The `OR` from `opportunityWhere` is overridden here deliberately —
   * a range on `endAt` is a narrower question than "is it on sale".
   */
  private opportunitiesEndingSoon(companyId: string, now: Date) {
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return this.prisma.opportunity.count({
      where: {
        companyId,
        status: "ACTIVE" as const,
        endAt: { gt: now, lte: soon },
      },
    });
  }

  /**
   * The listings the home screen shows, soonest to close first.
   *
   * THREE, because this is a summary with a link to the rest. A home
   * screen that lists everything is a list page with a worse header.
   */
  private async currentListings(
    companyId: string,
    now: Date,
  ): Promise<SupplierDashboardListing[]> {
    const rows = await this.prisma.opportunity.findMany({
      where: this.opportunityWhere(companyId, now),
      orderBy: { endAt: "asc" },
      take: 3,
      select: {
        id: true,
        productId: true,
        salesUnitNameAr: true,
        salesUnitNameEn: true,
        fulfillmentRegionNameAr: true,
        fulfillmentRegionNameEn: true,
        saleMode: true,
        targetQuantity: true,
        fundedQuantity: true,
        endAt: true,
        // THE NAME AND THE PICTURE COME FROM THE APPROVAL SNAPSHOT, not
        // from the product as it stands today: a listing shows what was
        // approved, and a later edit to the product must not change
        // what a live listing claims to be.
        productApprovalSnapshot: { select: { snapshot: true } },
      },
    });

    return rows.map((row) => {
      const snapshot = (row.productApprovalSnapshot?.snapshot ?? {}) as Record<
        string,
        unknown
      >;
      const media = selectMainMedia(row.productApprovalSnapshot?.snapshot);
      return {
        id: row.id,
        productId: row.productId,
        productNameAr:
          typeof snapshot.nameAr === "string" ? snapshot.nameAr : "",
        productNameEn:
          typeof snapshot.nameEn === "string" ? snapshot.nameEn : "",
        salesUnitNameAr: row.salesUnitNameAr,
        salesUnitNameEn: row.salesUnitNameEn,
        // A ROUTE, never a storage key — the same one the public
        // listing card uses, so a picture is served through the one
        // handler that checks who may see it.
        imageUrl: media
          ? `/api/v1/opportunities/${row.id}/image?variant=thumb`
          : null,
        regionNameAr: row.fulfillmentRegionNameAr,
        regionNameEn: row.fulfillmentRegionNameEn,
        saleMode: row.saleMode,
        targetQuantity: row.targetQuantity,
        fundedQuantity: row.fundedQuantity,
        // NULL for a direct sale — the card shows stock where a group
        // offer shows a countdown.
        endAt: row.endAt?.toISOString() ?? null,
      };
    });
  }
}
