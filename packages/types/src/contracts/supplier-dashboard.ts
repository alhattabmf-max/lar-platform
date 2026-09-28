import type { DashboardPeriod, DashboardRange } from "./dashboard";
import type { MoneyString } from "./money";
import type { SaleMode } from "./enums";
import type { OrderAllocationStatus } from "./order";

/**
 * THE SUPPLIER'S OWN LANDING SCREEN, as one read.
 *
 * WHY IT EXISTS. The supplier home used to assemble itself from six
 * list endpoints and count their lengths — which answers "how many
 * rows came back on the first page", not "how many are there". Every
 * figure below is a SUM or a COUNT the database performs, scoped to
 * the one company asking.
 *
 * IT REUSES THE ADMINISTRATOR'S OWN ARITHMETIC. The same columns, the
 * same windows, the same rule about what counts as paid — narrowed by
 * `supplier_company_id` and nothing else. A second definition of "paid
 * orders" is how a supplier's screen comes to disagree with the
 * console about the same week.
 *
 * MONEY CROSSES AS A STRING, because every amount is a `Decimal(14,2)`
 * and a JavaScript number cannot carry one back without losing the
 * last place.
 *
 * A COMPARISON THAT CANNOT BE MADE IS `null`, never zero and never a
 * percentage. A supplier's first month has no predecessor, and "0%"
 * would be a claim that nothing moved.
 *
 * NOTHING HERE IS INVENTED. There is no metric in this file that the
 * database cannot answer, and no field that exists to fill a space on
 * a design. Where a figure is genuinely unavailable the screen says so
 * rather than showing a plausible number.
 */

// --------------------------------------------------------- the cards

/** A figure and what it was in the window before this one. */
export interface SupplierMoneyMetric {
  value: MoneyString;
  previous: MoneyString | null;
  /** Null exactly when the previous window cannot be compared. */
  changePercent: number | null;
}

export interface SupplierCountMetric {
  value: number;
  previous: number | null;
  changePercent: number | null;
}

/**
 * The four figures across the top of the screen.
 *
 * `paidOrders` IS WHAT BUYERS PAID for this supplier's orders, the
 * same `total_amount` the console sums — not the supplier's share of
 * it, which is a different question and has its own card.
 *
 * `unsettledPayable` IS DELIVERED AND UNPAID: an allocation that has
 * been delivered and has no payout yet. It is deliberately NOT "every
 * payable ever raised" — an order still in a warehouse is not money
 * anybody is waiting for.
 */
export interface SupplierDashboardCards {
  paidOrders: SupplierMoneyMetric;
  /** Delivered, not yet transferred. Not all of it is transferable yet. */
  unsettledPayable: MoneyString;
  buyers: SupplierCountMetric;
  /** Buyers whose FIRST order from this supplier falls in the window. */
  newBuyers: number;
  activeOpportunities: number;
  /** Active and ending within seven days. */
  opportunitiesEndingSoon: number;
}

// -------------------------------------------------------- the series

export interface SupplierSeriesPoint {
  /** ISO instant at the bucket's start. */
  at: string;
  /** 1-based index within the window, for an axis that needs no date. */
  label: string;
  value: MoneyString;
}

/**
 * The sales line, and the refunds that are NOT in it.
 *
 * REFUNDS ARE SHOWN SEPARATELY AND NEVER NETTED OFF. A line that
 * silently subtracts them makes a good week look like a bad one and
 * gives no way to tell the two apart.
 */
export interface SupplierDashboardSeries {
  granularity: "daily" | "weekly";
  paidOrders: SupplierSeriesPoint[];
  /** Money that actually went back to buyers in this window. */
  refunded: MoneyString;
}

// -------------------------------------------------- current listings

/**
 * A listing as the home screen shows it.
 *
 * THE PLACE IS THE REGION, not the city, and that is the platform's
 * own rule rather than a shortcut: the region is what this platform
 * ships from, prices against and gates a listing on. The city is an
 * optional refinement beneath it and many listings have none.
 */
export interface SupplierDashboardListing {
  id: string;
  productId: string;
  productNameAr: string;
  productNameEn: string;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  /** Null for a product with no image, and for snapshots that predate media. */
  imageUrl: string | null;
  regionNameAr: string | null;
  regionNameEn: string | null;
  /** Which of the two sales paths this listing is. */
  saleMode: SaleMode;
  /** The collective target for a GROUP offer; the stock for a DIRECT one. */
  targetQuantity: number;
  /** How much of the target has been funded, or how much stock has sold. */
  fundedQuantity: number;
  /** ISO 8601. NULL for a direct sale, which has no window. */
  endAt: string | null;
}

// ------------------------------------------------------- settlements

/**
 * What has actually been transferred, and when the last one was.
 *
 * `lastTransfer` IS NULL UNTIL THERE HAS BEEN ONE. A zero with a date
 * of "never" reads as a transfer that happened for nothing.
 */
export interface SupplierDashboardSettlements {
  transferredInPeriod: MoneyString;
  lastTransfer: { amount: MoneyString; at: string } | null;
}

// -------------------------------------------------------- operations

/** One count per allocation status — the five the platform has. */
export type SupplierFulfilmentCounts = Record<OrderAllocationStatus, number>;

/**
 * What is waiting for this supplier to act.
 *
 * EACH ROW IS A COUNT AND A DESTINATION. A row whose count is zero is
 * not rendered at all: a permanently empty "needs attention" panel
 * teaches people to stop looking at it, which is the one thing it must
 * never do.
 */
export interface SupplierDashboardAttention {
  ordersAwaitingPreparation: number;
  disputesAwaitingResponse: number;
  replacementsAwaitingAction: number;
}

// ---------------------------------------------------------- the read

export interface SupplierDashboardOverview {
  period: DashboardPeriod;
  range: DashboardRange;
  /** When the server produced this, for «آخر تحديث». */
  generatedAt: string;
  cards: SupplierDashboardCards;
  series: SupplierDashboardSeries;
  listings: SupplierDashboardListing[];
  settlements: SupplierDashboardSettlements;
  fulfilment: SupplierFulfilmentCounts;
  attention: SupplierDashboardAttention;
}

export const SUPPLIER_DASHBOARD_KEYS = [
  "period",
  "range",
  "generatedAt",
  "cards",
  "series",
  "listings",
  "settlements",
  "fulfilment",
  "attention",
] as const satisfies readonly (keyof SupplierDashboardOverview)[];
