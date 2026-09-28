/**
 * The administrative dashboard, the orders view, and the follow-up
 * centre.
 *
 * MONEY CROSSES AS A STRING. Every amount here is a `Decimal(14,2)` in
 * the database, and a JavaScript number cannot carry one back without
 * losing the last place. Nothing in this file re-derives a commission,
 * a tax or a payable: each figure is the sum of a column the payment
 * flow already wrote.
 *
 * A COMPARISON THAT CANNOT BE MADE IS `null`, never zero and never a
 * percentage. A period with no predecessor — the first week of trading,
 * a range that reaches before the platform existed — has no change to
 * report, and "0%" would be a claim that nothing moved.
 */

// ------------------------------------------------------------ periods

/**
 * The windows the dashboard offers.
 *
 * A CLOSED SET, because each one also defines the period it is compared
 * against: the 30 days before the last 30, the year before this one.
 * An arbitrary range would have no such predecessor without inventing
 * one.
 */
export const DASHBOARD_PERIODS = ["7d", "30d", "90d", "ytd"] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export interface DashboardRange {
  /** ISO instants, half-open: `[from, to)`. */
  from: string;
  to: string;
}

/**
 * A figure and what it was last time.
 *
 * `changePercent` is null exactly when the previous period cannot be
 * compared — which the screen renders as an em dash rather than a
 * misleading number.
 */
export interface DashboardMoneyMetric {
  /** Decimal string, e.g. "1284750.00". */
  value: string;
  previous: string | null;
  changePercent: number | null;
}

export interface DashboardCountMetric {
  value: number;
  previous: number | null;
  changePercent: number | null;
}

// ----------------------------------------------------------- the cards

export interface DashboardFinancials {
  /**
   * SUM of `master_orders.total_amount` for orders created in the
   * period.
   *
   * EVERY ORDER IN THIS TABLE IS PAID. `master_orders` cannot be
   * written without a successful `payment_attempt_id` and a `paid_at`,
   * so there is no unpaid order to exclude — and none to display.
   */
  paidOrders: DashboardMoneyMetric;
  /** How many orders that sum is over. */
  paidOrderCount: number;

  /**
   * SUM of `master_orders.commission_amount`.
   *
   * THE PLATFORM'S CUT, NOT THE ORDER'S VALUE. Written once by the
   * payment flow that owns the commission rule; nothing here computes
   * a rate.
   */
  platformRevenue: DashboardMoneyMetric;
  /** Weighted average commission, in basis points. Null with no orders. */
  averageCommissionBasisPoints: number | null;

  /** SUM of `master_orders.supplier_payable_amount`. */
  supplierPayable: DashboardMoneyMetric;
  /** Allocations awaiting a payout. */
  pendingSettlements: number;

  /**
   * SUM of refund attempts that actually SUCCEEDED in the period.
   *
   * Not obligations raised, not attempts made: money that left.
   */
  refunded: DashboardMoneyMetric;
  /** Refunded as a share of paid orders. Null when nothing was paid. */
  refundRatePercent: number | null;
}

export interface DashboardOperations {
  /**
   * Successful payment attempts over the attempts that RESOLVED.
   *
   * The denominator counts `SUCCEEDED` and `FAILED` only: an attempt
   * still pending has not failed, and one superseded or expired was
   * never a chance to pay. Null when nothing resolved — a rate over
   * zero attempts is not zero per cent.
   */
  paymentSuccessRate: { value: number | null; previous: number | null };

  /** Opportunities open in the period, and how many close within seven days. */
  activeOpportunities: DashboardCountMetric;
  endingSoon: number;

  /**
   * Companies with at least ONE PAID ORDER in the period, counted
   * distinctly.
   *
   * NOT the registered total, and not "everyone who is not suspended":
   * a company is active because it traded.
   */
  activeSuppliers: DashboardCountMetric;
  activeBuyers: DashboardCountMetric;
}

// ------------------------------------------------------------- charts

export interface DashboardSeriesPoint {
  /** The bucket's start, ISO. */
  at: string;
  /** Already-formatted bucket label, e.g. "الأسبوع 1". */
  label: string;
  /** Decimal string. */
  value: string;
}

export interface DashboardFinancialSeries {
  /** Whether the buckets are days or weeks. */
  granularity: "daily" | "weekly";
  paidOrders: DashboardSeriesPoint[];
  platformRevenue: DashboardSeriesPoint[];
}

export interface DashboardGrowthPoint {
  at: string;
  label: string;
  /** NEW REGISTRATIONS in the bucket, never a running total. */
  buyers: number;
  suppliers: number;
}

// ------------------------------------------------- the order breakdown

/**
 * The four stages an order is shown in.
 *
 * `paid` IS THE TOTAL — every order created in the period, because none
 * exists unpaid. The other three are an EXCLUSIVE partition of that
 * same total: an order appears in exactly one of them, and they sum to
 * `paid`.
 *
 * `troubled` wins first: an order that needs intervention is that,
 * whatever its fulfilment status says.
 */
export interface DashboardOrderBreakdown {
  paid: number;
  inFulfilment: number;
  completed: number;
  troubled: number;
}

export interface DashboardOverview {
  period: DashboardPeriod;
  range: DashboardRange;
  previousRange: DashboardRange | null;
  /** When the figures were computed, ISO. */
  generatedAt: string;
  financials: DashboardFinancials;
  operations: DashboardOperations;
  series: DashboardFinancialSeries;
  growth: DashboardGrowthPoint[];
  orders: DashboardOrderBreakdown;
  attention: DashboardAttentionRow[];
}

// --------------------------------------------------- needs attention

export const FOLLOW_UP_CASE_KINDS = [
  "SETTLEMENT_OVERDUE",
  "PAYMENT_REPEATEDLY_FAILED",
  "DISPUTE_OPEN",
  "BANK_ACCOUNT_REVIEW",
  "SUPPLIER_VERIFICATION",
  // NO PRODUCT_REVIEW. A supplier publishes directly, so no case of that
  // kind can be raised any more; keeping it here would leave the
  // follow-up page offering a filter that can never match a row, and the
  // API accepting an assignment for a case that does not exist. The
  // Postgres enum keeps the value — nothing is dropped from the database.
] as const;

export type FollowUpCaseKind = (typeof FOLLOW_UP_CASE_KINDS)[number];

export const FOLLOW_UP_PRIORITIES = ["CRITICAL", "OVERDUE", "REVIEW"] as const;

export type FollowUpPriority = (typeof FOLLOW_UP_PRIORITIES)[number];

/**
 * What the overview may COUNT, which is not the same list as what the
 * follow-up centre may ASSIGN.
 *
 * THEY WERE ONE TYPE, and that is what stopped the platform reporting a
 * listing blocked by its own configuration. A follow-up case is an
 * assignable record: `follow_up_assignments.case_kind` is a Postgres
 * enum, so a new kind there is a migration. An attention row is a
 * counter and a link — nothing is stored against it. Tying the row to
 * the case meant the cheap thing could not be done without the
 * expensive one.
 *
 * A kind listed here and NOT in `FOLLOW_UP_CASE_KINDS` is therefore
 * counted on the overview and is deliberately not a case: it cannot be
 * assigned, and it appears in exactly one queue.
 */
export const DASHBOARD_ATTENTION_KINDS = [
  ...FOLLOW_UP_CASE_KINDS,
  /**
   * LIVE LISTINGS BLOCKED BY SOMETHING ONLY THE PLATFORM CAN FIX.
   *
   * A blocked listing sits in ACTION_REQUIRED carrying a reason code
   * that says why. Most of those reasons belong to the supplier — a
   * product they archived, a branch of theirs that is switched off — and
   * two do not: a CITY the platform deactivated, and a TAX RATE the
   * platform never configured. In both the supplier can do nothing at
   * all, and nothing anywhere told an operator that a configuration
   * change had taken listings off the market.
   *
   * The reasons that ARE the platform's but already have a queue of
   * their own — an unverified supplier, an unreviewed bank account —
   * are excluded on purpose. A case is counted once, where it is
   * decided.
   *
   * And NOT a product the platform suspended or closed itself: that is
   * a decision already taken, not work waiting to be done.
   */
  "LISTING_BLOCKED_BY_PLATFORM",
] as const;

export type DashboardAttentionKind =
  (typeof DASHBOARD_ATTENTION_KINDS)[number];

/** One line of "needs your attention" on the overview. */
export interface DashboardAttentionRow {
  kind: DashboardAttentionKind;
  count: number;
  priority: FollowUpPriority;
  /** Age of the OLDEST case of this kind, in hours. Null when none. */
  oldestAgeHours: number | null;
  /** Where the list for this kind lives, relative to the locale root. */
  href: string;
}

// ------------------------------------------------------- orders page

export interface AdminOrderStageInsight {
  paid: number;
  inFulfilment: number;
  completed: number;
  troubled: number;
  /** Successful payments over resolved attempts. Null when none resolved. */
  paymentSuccessRate: number | null;
  /** Mean hours from payment to preparation starting. Null with no data. */
  averageStartHours: number | null;
  /** Mean days from payment to every allocation delivered. */
  averageCompletionDays: number | null;
  /** Troubled as a share of paid. Null when nothing was paid. */
  troubledRatePercent: number | null;
  /** Change in paid orders against the previous period. */
  changePercent: number | null;
}

export const ADMIN_ORDER_STAGES = [
  "paid",
  "inFulfilment",
  "completed",
  "troubled",
] as const;

export type AdminOrderStage = (typeof ADMIN_ORDER_STAGES)[number];

export interface AdminOrderRow {
  id: string;
  reference: string;
  buyerCompanyId: string;
  buyerName: string;
  supplierCompanyId: string;
  supplierName: string;
  /** Decimal string. */
  totalAmount: string;
  stage: AdminOrderStage;
  /** Always true for a row in this table; carried so the column is honest. */
  paid: boolean;
  paidAt: string;
  createdAt: string;
}

// ------------------------------------------------- follow-up centre

export interface FollowUpCase {
  /** `kind:ref`, stable across reads — the row's identity in the UI. */
  id: string;
  kind: FollowUpCaseKind;
  caseRef: string;
  priority: FollowUpPriority;
  /** What the case is about, e.g. an order reference or a company name. */
  subject: string;
  /** Hours since the case became actionable. */
  ageHours: number;
  assigneeId: string | null;
  assigneeName: string | null;
  inProgress: boolean;
  /** Where the action for this case lives. */
  actionHref: string;
}

export interface FollowUpSummary {
  total: number;
  review: number;
  overdue: number;
  critical: number;
}

export interface FollowUpBoard {
  range: DashboardRange;
  generatedAt: string;
  /** Counted from the SAME list below, never from a separate query. */
  summary: FollowUpSummary;
  cases: FollowUpCase[];
  /** Every administrator who may be assigned a case. */
  assignees: { id: string; name: string }[];
  page: number;
  pageSize: number;
  total: number;
}
