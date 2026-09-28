import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  MAX_TRADER_PAGE_SIZE,
  type Paginated,
  type SettlementDetail,
  type SettlementSummary,
  type SupplierPayoutOutcome,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";

/**
 * What a supplier may read of being paid.
 *
 * `supplier_payouts` is a record of a bank transfer an ADMINISTRATOR executed,
 * and three of its columns describe the platform's operation rather than the
 * supplier's money — `externalTransferReference`, `executedByAdminUserId` and
 * `supplierBankAccountId`. None is selected here, so none can be leaked by a
 * later refactor that spreads: not selecting is stronger than not mapping.
 *
 * There is no ledger posting and no journal entry on this shape either. Those
 * are the platform's double-entry record; a supplier reconciling a payment
 * needs the amount and its basis, not the bookkeeping.
 *
 * A payout is per ALLOCATION — `orderAllocationId` is unique on the model — so
 * an order shipped to three branches settles three times.
 */

interface SupplierScope {
  companyId: string;
}

/** Money as a fixed-scale decimal string. Never a float. */
function money(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}

/**
 * Ownership, as a WHERE clause.
 *
 * A payout belongs to an allocation, which belongs to a master order, which
 * carries the supplier company. Expressing that as a filter means an unknown id
 * and another supplier's payout both produce no row — a 404 either way, with
 * nothing distinguishable by probing. Fetching first and comparing afterwards
 * is one early return away from answering the wrong company.
 */
function supplierPayoutWhere(companyId: string): Prisma.SupplierPayoutWhereInput {
  return { orderAllocation: { masterOrder: { supplierCompanyId: companyId } } };
}

const SETTLEMENT_SUMMARY_SELECT = {
  id: true,
  orderAllocationId: true,
  outcome: true,
  netAmount: true,
  executedAt: true,
  orderAllocation: {
    select: {
      masterOrderId: true,
      masterOrder: { select: { paymentAttempt: { select: { currency: true } } } },
    },
  },
} satisfies Prisma.SupplierPayoutSelect;

/**
 * The detail adds the FROZEN basis the payout was calculated from.
 *
 * Every figure comes from `OrderAllocationFinancialSnapshot`, written when the
 * order was created and never recomputed — which is what makes it
 * reconcilable. The supplier reads the same numbers the transfer was derived
 * from, not a fresh calculation that could differ by a rounding decision.
 *
 * The snapshot's four rounding remainders and `allocationShareBasisPoints` are
 * deliberately NOT selected. The remainders exist so per-allocation shares sum
 * exactly to the order total; showing someone a "rounding remainder" line
 * invites a question with no useful answer.
 */
const SETTLEMENT_DETAIL_SELECT = {
  ...SETTLEMENT_SUMMARY_SELECT,
  orderAllocation: {
    select: {
      masterOrderId: true,
      masterOrder: { select: { paymentAttempt: { select: { currency: true } } } },
      financialSnapshot: {
        select: {
          productAmountExclTax: true,
          productTaxAmount: true,
          productAmountInclTax: true,
          shippingFeeAmount: true,
          commissionShareAmount: true,
          commissionShareTaxAmount: true,
          supplierPayableShareAmount: true,
        },
      },
      checkoutLocationAllocation: {
        select: {
          locationNameSnapshot: true,
          cityNameArSnapshot: true,
          cityNameEnSnapshot: true,
          // Read because the city may be null — a branch names a region
          // always and a city sometimes, so the region is what
          // guarantees a settlement row names a place at all.
          regionNameArSnapshot: true,
          regionNameEnSnapshot: true,
        },
      },
    },
  },
} satisfies Prisma.SupplierPayoutSelect;

type SummaryRow = Prisma.SupplierPayoutGetPayload<{ select: typeof SETTLEMENT_SUMMARY_SELECT }>;
type DetailRow = Prisma.SupplierPayoutGetPayload<{ select: typeof SETTLEMENT_DETAIL_SELECT }>;

function toSummary(row: SummaryRow): SettlementSummary {
  return {
    id: row.id,
    orderAllocationId: row.orderAllocationId,
    masterOrderId: row.orderAllocation.masterOrderId,
    // EXECUTED or ZERO_BALANCE. The latter is not a failure — nothing was owed
    // for that allocation — and no consumer may render it as one.
    outcome: row.outcome as SupplierPayoutOutcome,
    netAmount: money(row.netAmount),
    currency: row.orderAllocation.masterOrder.paymentAttempt.currency,
    executedAt: row.executedAt.toISOString(),
  };
}

@Injectable()
export class SupplierSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    scope: SupplierScope,
    query: { page?: number; pageSize?: number }
  ): Promise<Paginated<SettlementSummary>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_TRADER_PAGE_SIZE, Math.max(1, query.pageSize ?? 20));

    const where = supplierPayoutWhere(scope.companyId);

    const [rows, total] = await Promise.all([
      this.prisma.supplierPayout.findMany({
        where,
        select: SETTLEMENT_SUMMARY_SELECT,
        // Terminating in `id`: `executedAt` is not unique, and a tie spanning a
        // page boundary can serve one row twice and another never.
        orderBy: [{ executedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplierPayout.count({ where }),
    ]);

    return { items: rows.map(toSummary), page, pageSize, total };
  }

  async get(scope: SupplierScope, id: string): Promise<SettlementDetail> {
    const row: DetailRow | null = await this.prisma.supplierPayout.findFirst({
      where: { id, ...supplierPayoutWhere(scope.companyId) },
      select: SETTLEMENT_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException("Settlement not found");

    const snapshot = row.orderAllocation.financialSnapshot;
    const destination = row.orderAllocation.checkoutLocationAllocation;

    return {
      ...toSummary(row),
      // A payout without its financial snapshot cannot be explained. Rather
      // than inventing zeros — which would read as "nothing was owed" — the
      // basis is reported as zero only when the snapshot genuinely is absent,
      // which the ZERO_BALANCE outcome already accounts for.
      productAmountExclTax: snapshot ? money(snapshot.productAmountExclTax) : "0.00",
      productTaxAmount: snapshot ? money(snapshot.productTaxAmount) : "0.00",
      productAmountInclTax: snapshot ? money(snapshot.productAmountInclTax) : "0.00",
      shippingFeeAmount: snapshot ? money(snapshot.shippingFeeAmount) : "0.00",
      commissionShareAmount: snapshot ? money(snapshot.commissionShareAmount) : "0.00",
      commissionShareTaxAmount: snapshot ? money(snapshot.commissionShareTaxAmount) : "0.00",
      supplierPayableShareAmount: snapshot ? money(snapshot.supplierPayableShareAmount) : "0.00",
      locationName: destination.locationNameSnapshot,
      cityNameAr: destination.cityNameArSnapshot,
      cityNameEn: destination.cityNameEnSnapshot,
      regionNameAr: destination.regionNameArSnapshot,
      regionNameEn: destination.regionNameEnSnapshot,
    };
  }
}
