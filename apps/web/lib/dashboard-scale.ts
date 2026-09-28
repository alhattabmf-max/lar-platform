import type { DashboardSeriesPoint } from "@platform/types";
import { BUSINESS_TIME_ZONE, isAppLocale } from "./localized";
import type { AppLocale } from "@/i18n/routing";

/**
 * The arithmetic behind the overview's two charts.
 *
 * A PLAIN MODULE, no directive and no JSX, so both the server page and
 * the client charts import the same functions — and so every rule here
 * can be tested without a DOM. What a reader sees on an axis is a
 * decision, and a decision belongs somewhere it can be checked.
 *
 * NOTHING HERE INVENTS A NUMBER. Every function takes what the API sent
 * and decides how to *present* it: where the gridlines fall, how a
 * bucket is named, whether there is enough of a series to draw a trend
 * at all. When there is not, the answer is "there is not" — never a
 * filled-in point, and never a line dropped to zero on both sides of
 * the one bucket that has data, which reads as a collapse that never
 * happened.
 */

// ------------------------------------------------------------ the axis

export interface Axis {
  /** The top of the scale — always ≥ the largest value. */
  ceiling: number;
  /** Gridline values from 0 up to the ceiling, inclusive. */
  ticks: number[];
}

/**
 * A scale whose gridlines are numbers a person would choose.
 *
 * The ceiling is rounded UP to 1, 2, 2.5 or 5 times a power of ten, so
 * the ticks land on values that can be read at a glance — 400 thousand,
 * not 383,177. Four intervals, which is what fits a card this height
 * without the labels touching.
 *
 * A SERIES OF ALL ZEROS still gets a scale. Returning nothing would
 * leave the chart with no axis at all, and "everything is zero" is a
 * real answer that deserves to be drawn as a flat line along a real
 * baseline.
 */
export function niceAxis(max: number, intervals = 4): Axis {
  if (!Number.isFinite(max) || max <= 0) {
    return { ceiling: 1, ticks: [0, 1] };
  }

  const rough = max / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;

  const step =
    (normalised <= 1
      ? 1
      : normalised <= 2
        ? 2
        : normalised <= 2.5
          ? 2.5
          : normalised <= 5
            ? 5
            : 10) * magnitude;

  const ceiling = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= ceiling + step / 2; value += step) {
    // Snapped, because repeated addition of 2.5 drifts into 7.500000001
    // and prints an axis nobody would draw.
    ticks.push(Math.round(value * 1e6) / 1e6);
  }

  return { ceiling, ticks };
}

/**
 * A whole-number axis, for counts.
 *
 * Registrations are people and companies: an axis reading 0, 0.5, 1 is
 * a scale for something that cannot be halved. This keeps the same nice
 * ceiling but refuses fractional steps, and never goes below four so a
 * single registration is one short column rather than a bar filling the
 * card.
 */
export function niceCountAxis(max: number, intervals = 4): Axis {
  const floorCeiling = Math.max(max, intervals);
  const axis = niceAxis(floorCeiling, intervals);
  if (axis.ticks.every((tick) => Number.isInteger(tick))) return axis;

  const step = Math.ceil(axis.ceiling / intervals);
  const ceiling = step * intervals;
  return {
    ceiling,
    ticks: Array.from({ length: intervals + 1 }, (_, i) => i * step),
  };
}

// -------------------------------------------------------- the numbers

export interface CompactUnits {
  /** e.g. «ألف» / "K". */
  thousand: string;
  /** e.g. «مليون» / "M". */
  million: string;
}

/**
 * An axis label short enough to fit beside a chart.
 *
 * "1,600,000" on a gridline is four characters of information and nine
 * of noise. The unit words are passed in rather than written here, so
 * an axis reads «1.6 مليون» in Arabic and "1.6M" in English from one
 * function and one message catalogue.
 *
 * ONE DECIMAL PLACE AT MOST, and none when the value is whole: "1.0M"
 * claims a precision the rounding just threw away.
 */
export function compactNumber(
  value: number,
  locale: AppLocale,
  units: CompactUnits,
): string {
  const safe = isAppLocale(locale) ? locale : "en-SA";
  const format = (n: number) =>
    new Intl.NumberFormat(safe, {
      maximumFractionDigits: n < 10 ? 1 : 0,
      numberingSystem: "latn",
    }).format(n);

  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000)
    return `${format(value / 1_000_000)} ${units.million}`;
  if (magnitude >= 1_000) return `${format(value / 1_000)} ${units.thousand}`;

  return new Intl.NumberFormat(safe, {
    maximumFractionDigits: 0,
    numberingSystem: "latn",
  }).format(value);
}

// -------------------------------------------------------- the buckets

/**
 * The dates one bucket covers, e.g. «2 – 8 أبريل».
 *
 * A DAILY bucket is one day and says so with a single date; a WEEKLY
 * one names both ends, because "week 3" alone tells a reader nothing
 * about which week of the year they are looking at.
 *
 * The end is the bucket's LAST day, not the next bucket's first: a
 * range printed as "2 – 9" over a seven-day bucket is eight days.
 */
export function bucketDateRange(
  at: string,
  granularity: "daily" | "weekly",
  locale: AppLocale,
): string | null {
  if (!isAppLocale(locale)) return null;

  const start = new Date(at);
  if (Number.isNaN(start.getTime())) return null;

  const dayOnly = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
    calendar: "gregory",
    numberingSystem: "latn",
  });
  const dayAndMonth = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: BUSINESS_TIME_ZONE,
    calendar: "gregory",
    numberingSystem: "latn",
  });

  if (granularity === "daily") return dayAndMonth.format(start);

  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  // The month is printed ONCE when both ends share it, and twice when
  // the bucket straddles a month boundary — which is exactly when a
  // reader needs to be told.
  const sameMonth =
    new Intl.DateTimeFormat("en", {
      month: "numeric",
      timeZone: BUSINESS_TIME_ZONE,
    }).format(start) ===
    new Intl.DateTimeFormat("en", {
      month: "numeric",
      timeZone: BUSINESS_TIME_ZONE,
    }).format(end);

  const from = sameMonth ? dayOnly.format(start) : dayAndMonth.format(start);
  // An EN DASH between two dates, and a bidi isolate around the pair so
  // the numbers do not reorder around it in an Arabic paragraph.
  return `${from} – ${dayAndMonth.format(end)}`;
}

// ----------------------------------------------------- enough to draw

/**
 * Whether a series has a shape worth drawing.
 *
 * TWO NON-ZERO BUCKETS IS THE THRESHOLD, and the reason is what a line
 * chart claims. One bucket with a value, surrounded by structural
 * zeros, draws a spike out of nothing and back into nothing — a reader
 * sees a business that appeared and collapsed inside a month, when the
 * truth is "one order, and no others yet". A number and a sentence say
 * that honestly; a line cannot.
 *
 * A series that is entirely zero is also "no trend": every bucket is a
 * real zero, and a flat line along the axis says nothing the total does
 * not already say.
 */
export function hasDrawableTrend(
  points: readonly DashboardSeriesPoint[],
): boolean {
  return points.filter((point) => Number(point.value) > 0).length >= 2;
}

