import type { DashboardPeriod, DashboardRange } from "@platform/types";

/**
 * The window a figure is measured over, and the one before it.
 *
 * HALF-OPEN, ALWAYS: `[from, to)`. A closed range double-counts anything
 * that lands exactly on the boundary — an order paid at midnight would
 * be in both this period and the last — and a range whose end is
 * "yesterday at 23:59:59.999" quietly loses the final millisecond.
 *
 * THE PREVIOUS PERIOD IS THE SAME LENGTH, immediately before. Comparing
 * thirty days against a calendar month would compare twenty-eight days
 * with thirty-one and call the difference growth.
 *
 * EVERYTHING IS UTC. The database stores `timestamptz`, the platform
 * settles in one country, and a boundary that moved with the reader's
 * clock would give two administrators different totals for the same
 * day. The screen formats in the reader's locale; the arithmetic does
 * not.
 */

export interface ResolvedPeriod {
  period: DashboardPeriod;
  current: DashboardRange;
  /**
   * Null when there is nothing to compare against — which the contract
   * carries through as a null change rather than a misleading zero.
   */
  previous: DashboardRange | null;
  /** Days or weeks, decided by how long the window is. */
  granularity: "daily" | "weekly";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days each named window covers. `ytd` is measured, not fixed. */
const DAYS: Record<Exclude<DashboardPeriod, "ytd">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function resolvePeriod(
  period: DashboardPeriod,
  now: Date,
): ResolvedPeriod {
  const to = now;

  if (period === "ytd") {
    // From the first instant of this year to now. Its predecessor is
    // the SAME NUMBER OF DAYS ending where this one began — not the
    // whole of last year, which would compare a partial year with a
    // complete one.
    const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const span = to.getTime() - from.getTime();
    const previousTo = from;
    const previousFrom = new Date(from.getTime() - span);

    return {
      period,
      current: { from: from.toISOString(), to: to.toISOString() },
      previous:
        span > 0
          ? { from: previousFrom.toISOString(), to: previousTo.toISOString() }
          : null,
      // A year of daily points is 365 columns nobody can read.
      granularity: span > 45 * DAY_MS ? "weekly" : "daily",
    };
  }

  const days = DAYS[period];
  const from = new Date(to.getTime() - days * DAY_MS);
  const previousTo = from;
  const previousFrom = new Date(from.getTime() - days * DAY_MS);

  return {
    period,
    current: { from: from.toISOString(), to: to.toISOString() },
    previous: {
      from: previousFrom.toISOString(),
      to: previousTo.toISOString(),
    },
    granularity: days <= 14 ? "daily" : "weekly",
  };
}

/**
 * How long one bucket is, in seconds.
 *
 * THE SAME NUMBER THE SQL DIVIDES BY. A chart's buckets are counted in
 * two places — this module builds the array, and the query decides
 * which bucket a row falls into — and the only way those two cannot
 * disagree is for both to read one definition.
 */
export function bucketSeconds(granularity: "daily" | "weekly"): number {
  return (granularity === "daily" ? DAY_MS : 7 * DAY_MS) / 1000;
}

/**
 * The buckets a chart is drawn from.
 *
 * Built from the range rather than from the data, so a week with no
 * orders is a gap in the line rather than a week that never happened.
 *
 * MEASURED FROM THE WINDOW'S START, not from a calendar boundary. The
 * queries that fill these buckets used to group by
 * `date_trunc('week', …)`, which always returns a MONDAY, and matched
 * those keys against the dates below — which start wherever the window
 * starts. For the 90-day window that is a Thursday, so no key ever
 * matched and the chart drew a flat line of zeros over real orders.
 * The 30-day window agreed only by coincidence, on the weekdays where
 * 30 days back happens to land on a Monday.
 *
 * Both sides now count the same way: bucket `n` is
 * `[from + n·step, from + (n+1)·step)`, and the query returns that
 * `n` directly rather than a date anybody has to re-derive.
 */
export function bucketsFor(
  range: DashboardRange,
  granularity: "daily" | "weekly",
): Date[] {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const step = granularity === "daily" ? DAY_MS : 7 * DAY_MS;

  const buckets: Date[] = [];
  for (let at = from.getTime(); at < to.getTime(); at += step) {
    buckets.push(new Date(at));
    // A guard, not a limit anybody should reach: 400 buckets is already
    // more than any of these windows produces.
    if (buckets.length > 400) break;
  }

  return buckets;
}

/**
 * A change from one figure to the next, as a percentage.
 *
 * NULL RATHER THAN A NUMBER in the two cases where a percentage would
 * lie: when there is no previous period at all, and when the previous
 * value was zero. "Up 100%" from nothing to one order is arithmetically
 * defensible and practically meaningless; the screen shows an em dash.
 */
export function changePercent(
  current: number,
  previous: number | null,
): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
