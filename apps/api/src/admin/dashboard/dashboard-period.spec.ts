import {
  bucketSeconds,
  bucketsFor,
  changePercent,
  resolvePeriod,
} from "./dashboard-period";

/**
 * The boundaries every figure on these three screens is measured over.
 *
 * A window that is off by one instant is a total that is off by an
 * order, and a comparison against the wrong predecessor is growth that
 * did not happen. Both are silent — nothing throws — so they are pinned
 * here rather than trusted.
 */

/** A fixed instant, so nothing in this file depends on when it runs. */
const NOW = new Date("2026-08-26T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("resolvePeriod", () => {
  it.each([
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
  ] as const)("measures %s back from now", (period, days) => {
    const resolved = resolvePeriod(period, NOW);

    expect(resolved.current.to).toBe(NOW.toISOString());
    expect(new Date(resolved.current.from).getTime()).toBe(
      NOW.getTime() - days * DAY,
    );
  });

  it.each(["7d", "30d", "90d"] as const)(
    "gives %s a predecessor of the SAME length, immediately before",
    (period) => {
      const resolved = resolvePeriod(period, NOW);
      const current =
        new Date(resolved.current.to).getTime() -
        new Date(resolved.current.from).getTime();
      const previous =
        new Date(resolved.previous!.to).getTime() -
        new Date(resolved.previous!.from).getTime();

      // Comparing thirty days against a calendar month would compare
      // twenty-eight with thirty-one and call the difference growth.
      expect(previous).toBe(current);
      // They MEET, they do not overlap: the previous ends exactly where
      // this one begins.
      expect(resolved.previous!.to).toBe(resolved.current.from);
    },
  );

  it("runs the year to date from the first instant of January", () => {
    const resolved = resolvePeriod("ytd", NOW);

    expect(resolved.current.from).toBe("2026-01-01T00:00:00.000Z");
    expect(resolved.current.to).toBe(NOW.toISOString());
  });

  it("compares the year to date against the same number of days before it", () => {
    const resolved = resolvePeriod("ytd", NOW);

    // Not "all of last year": that would compare a partial year with a
    // complete one and report a collapse every January.
    const span =
      new Date(resolved.current.to).getTime() -
      new Date(resolved.current.from).getTime();
    const previousSpan =
      new Date(resolved.previous!.to).getTime() -
      new Date(resolved.previous!.from).getTime();

    expect(previousSpan).toBe(span);
    expect(resolved.previous!.to).toBe(resolved.current.from);
  });

  it("has no predecessor for a year that has not started", () => {
    const newYear = new Date("2026-01-01T00:00:00.000Z");

    // Zero days of trading has nothing to be compared against, and the
    // contract carries that through as a null change.
    expect(resolvePeriod("ytd", newYear).previous).toBeNull();
  });

  it.each([
    ["7d", "daily"],
    ["30d", "weekly"],
    ["90d", "weekly"],
  ] as const)("draws %s in %s buckets", (period, granularity) => {
    // A quarter of daily points is ninety columns nobody can read.
    expect(resolvePeriod(period, NOW).granularity).toBe(granularity);
  });
});

describe("bucketsFor", () => {
  it("covers the window, and stops before its end", () => {
    const range = {
      from: "2026-08-19T00:00:00.000Z",
      to: "2026-08-26T00:00:00.000Z",
    };

    const buckets = bucketsFor(range, "daily");

    expect(buckets).toHaveLength(7);
    expect(buckets[0].toISOString()).toBe("2026-08-19T00:00:00.000Z");
    // HALF-OPEN: the 26th belongs to the next window, not this one.
    expect(buckets.at(-1)!.toISOString()).toBe("2026-08-25T00:00:00.000Z");
  });

  it("is built from the RANGE, not from any data", () => {
    // A week with no orders must be a zero on the line, not a week that
    // never happened — which is only possible if the buckets exist
    // before the rows are read.
    const range = {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-03-01T00:00:00.000Z",
    };

    expect(bucketsFor(range, "weekly").length).toBeGreaterThan(7);
  });
});

/**
 * THE TWO SIDES OF A BUCKET, and the defect that came of them disagreeing.
 *
 * The array below is one half of the answer; the other half is the SQL
 * that decides which bucket a row belongs to. While that query grouped
 * by `date_trunc('week', …)` — always a Monday — and the array started
 * wherever the window started, the two key spaces only met by accident.
 * They met for the 30-day window on some weekdays and never at all for
 * the 90-day one, so a real order simply did not appear on the chart.
 *
 * These cases pin the shared definition: bucket `n` covers
 * `[from + n·step, from + (n+1)·step)`, and the index of a row is
 * `floor((row - from) / step)` — the same arithmetic on both sides.
 */
describe("a bucket means the same thing to the array and to the query", () => {
  /** What the SQL computes, written out in TypeScript. */
  function indexOf(at: Date, from: Date, granularity: "daily" | "weekly") {
    return Math.floor(
      (at.getTime() - from.getTime()) / (bucketSeconds(granularity) * 1000),
    );
  }

  it("measures a bucket in whole days or whole weeks", () => {
    expect(bucketSeconds("daily")).toBe(86_400);
    expect(bucketSeconds("weekly")).toBe(604_800);
  });

  it("puts every instant of the window in exactly one bucket that exists", () => {
    // A WEDNESDAY, which is what made this defect intermittent: 90 days
    // back from one lands on a Thursday and 30 days back on a Monday,
    // so one window agreed with `date_trunc('week')` and the other
    // could not.
    const now = new Date("2026-08-26T02:07:00.000Z");

    for (const period of ["7d", "30d", "90d"] as const) {
      const resolved = resolvePeriod(period, now);
      const buckets = bucketsFor(resolved.current, resolved.granularity);
      const from = new Date(resolved.current.from);
      const to = new Date(resolved.current.to);

      // Walk the window in six-hour steps: every instant in it must
      // index to a bucket the array actually holds.
      for (
        let at = from.getTime();
        at < to.getTime();
        at += 6 * 60 * 60 * 1000
      ) {
        const index = indexOf(new Date(at), from, resolved.granularity);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(buckets.length);
      }
    }
  });

  it("indexes a row to the bucket whose span contains it", () => {
    const now = new Date("2026-08-26T02:07:00.000Z");
    const resolved = resolvePeriod("90d", now);
    const buckets = bucketsFor(resolved.current, resolved.granularity);
    const from = new Date(resolved.current.from);

    // The one order in the development database.
    const order = new Date("2026-08-23T19:06:39.385Z");
    const index = indexOf(order, from, resolved.granularity);

    const start = buckets[index];
    const end = new Date(
      start.getTime() + bucketSeconds(resolved.granularity) * 1000,
    );
    expect(order.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(order.getTime()).toBeLessThan(end.getTime());
  });

  it("would have LOST that order under the calendar-week key", () => {
    // The regression this replaces, stated as a fact rather than a
    // memory: Monday 2026-08-17 is not one of the 90-day window's
    // bucket starts, so grouping by it produced a key nothing matched.
    const resolved = resolvePeriod("90d", new Date("2026-08-26T02:07:00.000Z"));
    const buckets = bucketsFor(resolved.current, resolved.granularity);
    const starts = buckets.map((at) => at.toISOString().slice(0, 10));

    expect(starts).not.toContain("2026-08-17");
    expect(starts).toContain("2026-08-20");
  });
});

describe("changePercent", () => {
  it("reports a rise and a fall", () => {
    expect(changePercent(120, 100)).toBe(20);
    expect(changePercent(80, 100)).toBe(-20);
  });

  it("is NULL when there was no previous period", () => {
    // An em dash on the screen, not "0%", which would claim nothing
    // moved when in truth nothing was known.
    expect(changePercent(500, null)).toBeNull();
  });

  it("is NULL when the previous value was zero", () => {
    // "Up 100%" from nothing to one order is arithmetically defensible
    // and practically meaningless.
    expect(changePercent(1, 0)).toBeNull();
  });

  it("reports no change as zero, which is a real answer", () => {
    expect(changePercent(100, 100)).toBe(0);
  });

  it("keeps one decimal place", () => {
    expect(changePercent(1001, 1000)).toBe(0.1);
  });
});
