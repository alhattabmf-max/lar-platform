import { RotateCcw } from "lucide-react";
import type { SupplierDashboardSeries } from "@platform/types";
import { Money } from "@/components/ui/money";
import type { AppLocale } from "@/i18n/routing";

/** Every amount on this platform is Saudi riyals. */
const SAR = "SAR";

/**
 * «حركة المبيعات» — the value of paid orders, bucket by bucket.
 *
 * IT IS DRAWN FROM THE SERIES AND NOTHING ELSE. No smoothing that
 * invents a value between two points, no projection past the last one,
 * no baseline shifted to flatter the shape. The line is the numbers.
 *
 * A BUCKET WITH NO ORDERS IS A ZERO, not a gap: the server builds the
 * buckets from the window rather than from the rows, so a quiet week is
 * a week on the axis rather than a week that vanished.
 *
 * WITH NOTHING TO DRAW IT SAYS SO. A flat line at zero across an empty
 * month is a chart claiming a trend; an empty state claims nothing.
 *
 * REFUNDS ARE BESIDE THE LINE, NEVER INSIDE IT. Netting them off makes
 * a good week look like a bad one and gives no way to tell them apart.
 *
 * INLINE SVG, no chart library: it is a polyline, four labels and an
 * axis, and a dependency for that would be a dependency to keep.
 */

export interface SalesChartLabels {
  title: string;
  subtitle: string;
  refunded: string;
  refundsSeparate: string;
  empty: string;
  /** The y-axis unit, e.g. «ألف». */
  thousands: string;
  /** The x-axis prefix, e.g. «الأسبوع». */
  bucket: string;
}

/** The drawing box. The SVG scales; these are its own coordinates. */
const W = 560;
const H = 190;
const PAD_X = 12;
const PAD_Y = 14;

export function SalesChart({
  series,
  locale,
  labels,
}: {
  series: SupplierDashboardSeries;
  locale: AppLocale;
  labels: SalesChartLabels;
}) {
  const points = series.paidOrders.map((p) => Number(p.value));
  const peak = Math.max(...points, 0);
  const everySold = points.some((value) => value > 0);

  /**
   * THE AXIS TOPS OUT AT A ROUND NUMBER above the peak, so the four
   * gridline labels are readable rather than the peak's own decimals.
   */
  const ceiling = everySold ? niceCeiling(peak) : 0;
  const ticks = [0, ceiling / 3, (ceiling * 2) / 3, ceiling];

  const x = (index: number) =>
    points.length <= 1
      ? W / 2
      : PAD_X + (index * (W - PAD_X * 2)) / (points.length - 1);
  const y = (value: number) =>
    ceiling === 0 ? H - PAD_Y : H - PAD_Y - (value / ceiling) * (H - PAD_Y * 2);

  const line = points.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `${PAD_X},${H - PAD_Y} ${line} ${x(points.length - 1)},${H - PAD_Y}`;

  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-card bg-surface px-card-x py-card-y shadow-card"
      data-testid="sales-chart"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col">
          <h2 className="text-base font-semibold text-content">
            {labels.title}
          </h2>
          <span className="text-xs text-content-muted">{labels.subtitle}</span>
        </span>
      </div>

      {everySold ? (
        <>
          <div className="flex min-w-0 gap-2">
            {/* THE AXIS IS TEXT, not part of the drawing: it has to
                stay readable at any width and follow the reading
                direction. */}
            <div
              className="flex shrink-0 flex-col-reverse justify-between py-1 text-[10px] text-content-muted"
              aria-hidden
            >
              {ticks.map((tick) => (
                <span key={tick}>{axisLabel(tick, labels.thousands)}</span>
              ))}
            </div>

            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-40 min-w-0 flex-1"
              preserveAspectRatio="none"
              role="img"
              aria-label={labels.title}
            >
              {ticks.map((tick) => (
                <line
                  key={tick}
                  x1={0}
                  x2={W}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                />
              ))}
              <polygon points={area} fill="var(--color-primary)" opacity={0.08} />
              <polyline
                points={line}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* THE LAST POINT IS MARKED, because it is the one the
                  reader is looking for. */}
              <circle
                cx={x(points.length - 1)}
                cy={y(points[points.length - 1] ?? 0)}
                r={5}
                fill="var(--color-surface)"
                stroke="var(--color-accent)"
                strokeWidth={3}
              />
            </svg>
          </div>

          <div className="flex justify-between text-[10px] text-content-muted">
            {series.paidOrders.map((point) => (
              <span key={point.at}>
                {labels.bucket} {point.label}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p
          className="py-8 text-center text-sm text-content-muted"
          data-testid="sales-chart-empty"
        >
          {labels.empty}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <span
          /* A READ-OUT, not a control — it takes the card's own
             padding rather than a button's, which is also what keeps
             it from reading as something to press. */
          className="inline-flex items-center gap-2 rounded-card border border-line px-3 py-2"
          data-testid="sales-chart-refunded"
        >
          <RotateCcw className="size-4 text-content-muted" aria-hidden />
          <span className="flex flex-col">
            <span className="text-[10px] text-content-muted">
              {labels.refunded}
            </span>
            <span className="text-sm font-semibold text-content">
              <Money
                amount={series.refunded}
                currency={SAR}
                locale={locale}
                fallback={series.refunded}
              />
            </span>
          </span>
        </span>
        <span className="text-xs text-content-muted">
          {labels.refundsSeparate}
        </span>
      </div>
    </section>
  );
}

/** The next round number at or above the peak, so the axis reads well. */
function niceCeiling(peak: number): number {
  if (peak <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  return Math.ceil(peak / magnitude) * magnitude;
}

/** «60 ألف» past a thousand, the plain number below it. */
function axisLabel(value: number, thousands: string): string {
  if (value >= 1000) return `${Math.round(value / 1000)} ${thousands}`;
  return String(Math.round(value));
}
