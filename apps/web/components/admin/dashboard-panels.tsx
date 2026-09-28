import type { ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, ChevronRight, ClipboardList, Clock } from "lucide-react";
import type {
  DashboardAttentionRow,
  DashboardFinancialSeries,
  DashboardGrowthPoint,
  FollowUpPriority,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/cn";
import { hasDrawableTrend, type CompactUnits } from "@/lib/dashboard-scale";
import { Delta, type DeltaIntent } from "./dashboard-chrome";
import { GrowthChart, LineChart, StatusBar } from "./dashboard-charts";

/**
 * The four panels beneath the eight cards.
 *
 * SERVER COMPONENTS that compose the client charts. Nothing here holds
 * state; the hovering and the focusing belong to the plots themselves,
 * and keeping the arrangement on the server means the message
 * catalogue is not shipped to draw it.
 *
 * EACH PANEL IS COMPACT ON PURPOSE. The whole screen has to reach its
 * last two cards inside one desktop window, and a chart that is half a
 * screen tall is the single biggest reason the page ran to two.
 */

// ------------------------------------------------- financial performance

export interface FinancialPerformanceLabels {
  title: string;
  /** «يومي» or «أسبوعي», already chosen for the granularity in play. */
  granularity: string;
  current: string;
  comparison: string;
  notEnoughData: string;
  units: CompactUnits;
  paidOrders: string;
  platformRevenue: string;
  /** e.g. «الأسبوع 1» per bucket, already numbered. */
  bucketNames: string[];
}

export function FinancialPerformance({
  series,
  locale,
  totals,
  labels,
}: {
  series: DashboardFinancialSeries;
  locale: AppLocale;
  /** The window's own totals and comparisons, already formatted. */
  totals: {
    paidOrders: { value: ReactNode; delta: number | null };
    platformRevenue: { value: ReactNode; delta: number | null };
  };
  labels: FinancialPerformanceLabels;
}) {
  const rows = [
    {
      key: "paid-orders",
      name: labels.paidOrders,
      tone: "primary" as const,
      points: series.paidOrders,
      total: totals.paidOrders,
      testId: "chart-paid-orders",
    },
    {
      key: "revenue",
      name: labels.platformRevenue,
      tone: "accent" as const,
      points: series.platformRevenue,
      total: totals.platformRevenue,
      testId: "chart-revenue",
    },
  ];

  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface p-3"
      data-testid="card-financial-performance"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-content">{labels.title}</h2>
        {/* A STATEMENT, NOT A CONTROL. The bucket size is decided by the
            window — daily up to a fortnight, weekly beyond it — so a
            switch here would be a button that changes nothing. It says
            which one is in force instead. */}
        <span
          className="rounded-full border border-line px-2 py-0.5 text-[11px] text-content-muted"
          data-testid="chart-granularity"
        >
          {labels.granularity}
        </span>
      </div>

      {rows.map((row) => (
        <div
          key={row.key}
          className="grid min-w-0 gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)]"
        >
          {/* THE FIGURE STAYS EVEN WHEN THE LINE CANNOT BE DRAWN. A
              window with one order still has a total, and that total is
              the honest answer to "how much". */}
          <div className="flex min-w-0 flex-col justify-center gap-0.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-content-muted">
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  row.tone === "accent" ? "bg-accent" : "bg-primary",
                )}
              />
              {labels.current}
            </span>
            <span
              className="truncate text-base font-semibold leading-tight text-content tabular-nums"
              data-testid={`${row.testId}-total`}
            >
              <bdi>{row.total.value}</bdi>
            </span>
            <span className="text-[11px] text-content-muted">
              {labels.comparison}
            </span>
            <Delta value={row.total.delta} testId={`${row.testId}-delta`} />
          </div>

          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[11px] text-content-muted">
              {row.name}
            </span>
            <LineChart
              points={row.points}
              granularity={series.granularity}
              locale={locale}
              tone={row.tone}
              drawable={hasDrawableTrend(row.points)}
              testId={row.testId}
              labels={{
                chart: row.name,
                units: labels.units,
                bucketNames: labels.bucketNames,
                notEnoughData: labels.notEnoughData,
              }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------ company growth

export interface CompanyGrowthLabels {
  title: string;
  buyers: string;
  suppliers: string;
  empty: string;
  units: CompactUnits;
  bucketNames: string[];
}

export function CompanyGrowth({
  points,
  granularity,
  locale,
  labels,
}: {
  points: DashboardGrowthPoint[];
  granularity: "daily" | "weekly";
  locale: AppLocale;
  labels: CompanyGrowthLabels;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface p-3"
      data-testid="card-growth"
    >
      <h2 className="text-sm font-semibold text-content">{labels.title}</h2>
      <GrowthChart
        points={points}
        granularity={granularity}
        locale={locale}
        testId="chart-growth"
        labels={{
          chart: labels.title,
          units: labels.units,
          bucketNames: labels.bucketNames,
          // The line chart's sentence has no meaning for columns: every
          // bucket is drawn, so the only empty case is "nobody
          // registered", which has its own wording.
          notEnoughData: labels.empty,
          buyers: labels.buyers,
          suppliers: labels.suppliers,
          empty: labels.empty,
        }}
      />
    </section>
  );
}

// -------------------------------------------------------- order status

export function OrderStatus({
  counts,
  href,
  labels,
}: {
  counts: { completed: number; inFulfilment: number; troubled: number };
  href: string;
  labels: {
    title: string;
    completed: string;
    inFulfilment: string;
    troubled: string;
    link: string;
  };
}) {
  return (
    <section
      className="flex min-w-0 flex-col justify-between gap-2 rounded-md border border-line bg-surface p-3"
      data-testid="card-order-status"
    >
      <h2 className="text-sm font-semibold text-content">{labels.title}</h2>

      <StatusBar
        testId="order-status"
        segments={[
          {
            key: "completed",
            label: labels.completed,
            count: counts.completed,
            tone: "bg-primary",
          },
          {
            key: "inFulfilment",
            label: labels.inFulfilment,
            count: counts.inFulfilment,
            tone: "bg-accent",
          },
          {
            key: "troubled",
            label: labels.troubled,
            count: counts.troubled,
            tone: "bg-danger",
          },
        ]}
      />

      <PanelLink href={href} label={labels.link} testId="link-orders" />
    </section>
  );
}

// ----------------------------------------------------- needs attention

/** CRITICAL first, then OVERDUE, then REVIEW — and the oldest of each. */
const PRIORITY_ORDER: Record<FollowUpPriority, number> = {
  CRITICAL: 0,
  OVERDUE: 1,
  REVIEW: 2,
};

/** How many cases the panel shows before deferring to the follow-up centre. */
const MAX_ROWS = 4;

export function NeedsAttention({
  rows,
  locale,
  href,
  labels,
}: {
  rows: DashboardAttentionRow[];
  locale: AppLocale;
  href: string;
  labels: {
    title: string;
    link: string;
    empty: string;
    /** `case.KIND` and `priority.KIND`, already translated, plus the age line. */
    caseName: (row: DashboardAttentionRow) => string;
    priorityName: (priority: FollowUpPriority) => string;
    age: (hours: number) => string;
  };
}) {
  // SORTED FOR DISPLAY ONLY. The figures are the API's; which four of
  // them fit on a card this size is a decision about the card.
  const shown = [...rows]
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        (b.oldestAgeHours ?? 0) - (a.oldestAgeHours ?? 0),
    )
    .slice(0, MAX_ROWS);

  return (
    <section
      className="flex min-w-0 flex-col justify-between gap-2 rounded-md border border-line bg-surface p-3"
      data-testid="card-attention"
    >
      <h2 className="text-sm font-semibold text-content">{labels.title}</h2>

      {shown.length === 0 ? (
        <p
          className="py-2 text-sm text-content-muted"
          data-testid="attention-empty"
        >
          {labels.empty}
        </p>
      ) : (
        <ul className="flex list-none flex-col divide-y divide-line">
          {shown.map((row) => (
            <li key={row.kind}>
              {/* A LINK, so opening a case neither closes it nor takes
                  it off this list. */}
              <Link
                href={`/${locale}${row.href}`}
                data-testid={`attention-${row.kind}`}
                className="flex items-center gap-2 py-1.5 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <PriorityBadge
                  priority={row.priority}
                  label={labels.priorityName(row.priority)}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-content">
                  {labels.caseName(row)}
                </span>
                <span className="shrink-0 text-[11px] text-content-muted">
                  {row.oldestAgeHours === null
                    ? "—"
                    : labels.age(row.oldestAgeHours)}
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-content-muted rtl:-scale-x-100"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <PanelLink href={href} label={labels.link} testId="link-follow-up" />
    </section>
  );
}

// -------------------------------------------------------------- pieces

/**
 * A panel's way out.
 *
 * A REAL CONTROL, not a run of underlined words. The design gives each
 * panel one destination with an arrow, at a height a finger can hit;
 * an inline underline reads as body text that happens to be blue.
 */
function PanelLink({
  href,
  label,
  testId,
}: {
  href: string;
  label: string;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1 self-start rounded-md text-sm font-medium text-primary",
        "hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
      )}
    >
      {label}
      {/* Mirrored by the document's direction rather than by a branch:
          it points the way the reader is going in both scripts. */}
      <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
    </Link>
  );
}

export function PriorityBadge({
  priority,
  label,
}: {
  priority: FollowUpPriority;
  label: string;
}) {
  const tone =
    priority === "CRITICAL"
      ? "border-danger text-danger"
      : priority === "OVERDUE"
        ? "border-warning text-warning-text"
        : "border-line text-content-muted";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]",
        tone,
      )}
    >
      {priority === "CRITICAL" ? (
        <AlertCircle className="size-3" aria-hidden />
      ) : priority === "OVERDUE" ? (
        <Clock className="size-3" aria-hidden />
      ) : (
        <ClipboardList className="size-3" aria-hidden />
      )}
      {label}
    </span>
  );
}

/** Exported for the delta intents the overview assigns to each card. */
export type { DeltaIntent };
