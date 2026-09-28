"use client";

import { useId, useState } from "react";
import type {
  DashboardGrowthPoint,
  DashboardSeriesPoint,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/cn";
import {
  bucketDateRange,
  compactNumber,
  niceAxis,
  niceCountAxis,
  type CompactUnits,
} from "@/lib/dashboard-scale";

/**
 * The two charts on the overview, drawn as plain SVG.
 *
 * NO CHARTING LIBRARY. These are a line with a fill and a pair of
 * columns; a library for them would be two hundred kilobytes shipped to
 * every administrator to draw shapes an `<svg>` already draws — and it
 * would bring its own palette, which is how a screen ends up with
 * colours that are not the product's.
 *
 * EVERY COLOUR IS A TOKEN. `currentColor` inherits from a Tailwind text
 * class, so the navy and the amber here are the same navy and amber as
 * the rest of the console and cannot drift from it.
 *
 * GEOMETRY IN AN SVG, TEXT AND TARGETS IN HTML. The plot is stretched
 * to whatever width the card has, which turns a circle into an ellipse
 * and a caption into a smear. Only the fill and the line live inside
 * the stretched box; the axis labels, the point markers and the
 * tooltip are ordinary elements positioned over it, so they keep their
 * shape at every card width and can be reached with a keyboard.
 *
 * TIME RUNS LEFT TO RIGHT IN BOTH SCRIPTS, so the plot area is marked
 * `dir="ltr"` and every offset inside it is written as a logical
 * `start`. The axis is not mirrored for Arabic — a rising line would
 * otherwise read as a falling one.
 */

/** The plot's own coordinate space. Percentages, so the box can be any size. */
const BOX = 100;

export interface ChartLabels {
  /** The figure's name, for a reader who cannot see the chart. */
  chart: string;
  units: CompactUnits;
  /** e.g. «الأسبوع {n}» / «اليوم {n}», with `{n}` already replaced per point. */
  bucketNames: string[];
  /** Shown in place of a line that would mislead. */
  notEnoughData: string;
}

/** How many x-axis captions a plot this wide can hold without overlapping. */
const MAX_X_LABELS = 7;

function visibleLabelIndexes(count: number): Set<number> {
  if (count <= MAX_X_LABELS)
    return new Set(Array.from({ length: count }, (_, i) => i));

  // Thinned rather than shrunk: a caption too small to read is worse
  // than a caption that is not there. The LAST bucket always keeps its
  // name, because "where does this end" is the question a reader asks
  // of a time axis first.
  const stride = Math.ceil(count / MAX_X_LABELS);
  const keep = new Set<number>();
  for (let i = 0; i < count; i += stride) keep.add(i);
  keep.add(count - 1);
  return keep;
}

// --------------------------------------------------------- line chart

/**
 * One series, as a line with the area beneath it filled.
 *
 * IT REFUSES TO DRAW A MISLEADING SHAPE. A single bucket with a value,
 * surrounded by the structural zeros of buckets that simply have no
 * orders yet, draws a spike out of nothing and back into nothing — a
 * reader sees a collapse that never happened. Below two non-zero
 * buckets this renders the sentence instead, and the total is shown
 * beside it by the panel that owns this chart.
 *
 * Whether there is enough is decided by `hasDrawableTrend`, and the
 * caller passes the verdict in — so the panel and the chart cannot
 * disagree about what is on screen.
 */
export function LineChart({
  points,
  granularity,
  locale,
  tone,
  labels,
  drawable,
  testId,
}: {
  points: readonly DashboardSeriesPoint[];
  granularity: "daily" | "weekly";
  locale: AppLocale;
  /** `primary` is the navy of order value; `accent` the amber of revenue. */
  tone: "primary" | "accent";
  labels: ChartLabels;
  /** False when a line would claim a trend the data does not support. */
  drawable: boolean;
  testId: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();

  if (!drawable) {
    return (
      <p
        className="rounded-md border border-dashed border-line-control px-3 py-6 text-center text-xs text-content-muted"
        data-testid={`${testId}-insufficient`}
      >
        {labels.notEnoughData}
      </p>
    );
  }

  const values = points.map((point) => Number(point.value));
  const axis = niceAxis(Math.max(...values));
  const shown = visibleLabelIndexes(points.length);

  // The horizontal position of bucket `index`, as a percentage. A
  // single bucket sits in the middle rather than at the left edge.
  const xOf = (index: number) =>
    points.length > 1 ? (index / (points.length - 1)) * BOX : BOX / 2;
  const yOf = (value: number) => BOX - (value / axis.ceiling) * BOX;

  const coords = values.map(
    (value, index) => [xOf(index), yOf(value)] as const,
  );
  const line = coords
    .map(
      ([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`,
    )
    .join(" ");
  const area = `${line} L ${BOX} ${BOX} L 0 ${BOX} Z`;

  const colour = tone === "accent" ? "text-accent" : "text-primary";

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1", colour)}
      data-testid={testId}
    >
      <div className="flex min-w-0 items-stretch gap-2">
        {/* THE SCALE, as real text outside the stretched box. */}
        <ul
          className="flex list-none flex-col-reverse justify-between text-[10px] leading-none text-content-muted"
          aria-hidden
        >
          {axis.ticks.map((tick) => (
            <li key={tick} className="tabular-nums">
              {compactNumber(tick, locale, labels.units)}
            </li>
          ))}
        </ul>

        <div
          dir="ltr"
          className="relative min-w-0 flex-1"
          style={{ height: "5.5rem" }}
        >
          <svg
            viewBox={`0 0 ${BOX} ${BOX}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={labels.chart}
            focusable="false"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                <stop
                  offset="100%"
                  stopColor="currentColor"
                  stopOpacity="0.02"
                />
              </linearGradient>
            </defs>

            {axis.ticks.map((tick) => (
              <line
                key={tick}
                x1="0"
                x2={BOX}
                y1={yOf(tick)}
                y2={yOf(tick)}
                className="stroke-line"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            <path d={area} fill={`url(#${gradientId})`} />
            <path
              d={line}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              // Scales with the viewBox, so the stroke does not thicken
              // when the card is narrow.
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* ONE FOCUSABLE MARKER PER BUCKET. A chart whose exact
              figures are available only to a mouse is a chart half the
              readers cannot use. */}
          {points.map((point, index) => {
            const [x, y] = coords[index];
            const open = active === index;

            return (
              <button
                key={point.at}
                type="button"
                className="absolute size-6 -translate-x-1/2 translate-y-1/2 rounded-full focus-visible:outline focus-visible:outline-2"
                style={{ insetInlineStart: `${x}%`, bottom: `${BOX - y}%` }}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() =>
                  setActive((current) => (current === index ? null : current))
                }
                onFocus={() => setActive(index)}
                onBlur={() =>
                  setActive((current) => (current === index ? null : current))
                }
                data-testid={`${testId}-point-${index}`}
                aria-describedby={open ? `${gradientId}-tip` : undefined}
              >
                <span className="sr-only">
                  {labels.bucketNames[index]} — {point.value}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current",
                    open && "ring-2 ring-surface",
                  )}
                />
              </button>
            );
          })}

          {active !== null ? (
            <Tooltip
              id={`${gradientId}-tip`}
              x={coords[active][0]}
              lines={[
                labels.bucketNames[active],
                bucketDateRange(points[active].at, granularity, locale) ?? "",
                points[active].value,
              ]}
              testId={`${testId}-tooltip`}
            />
          ) : null}
        </div>
      </div>

      <XAxis
        names={labels.bucketNames}
        points={points.map((point) => point.at)}
        granularity={granularity}
        locale={locale}
        shown={shown}
        testId={`${testId}-axis`}
      />
    </div>
  );
}

// ------------------------------------------------------- growth chart

/**
 * New registrations per bucket, buyers beside suppliers.
 *
 * PAIRS OF COLUMNS, not a stack: the question is "how many of each",
 * and a stacked bar answers "how many altogether" instead.
 *
 * EVERY BUCKET KEEPS ITS SLOT, including the ones with nothing in them.
 * A period that saw no registrations is a zero with a name under it,
 * not a gap — and drawing only the buckets that have data would leave
 * two columns floating in an empty card with no way to tell how much
 * time they cover.
 */
export function GrowthChart({
  points,
  granularity,
  locale,
  labels,
  testId,
}: {
  points: readonly DashboardGrowthPoint[];
  granularity: "daily" | "weekly";
  locale: AppLocale;
  labels: ChartLabels & { buyers: string; suppliers: string; empty: string };
  testId: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();

  const max = Math.max(
    0,
    ...points.flatMap((point) => [point.buyers, point.suppliers]),
  );
  const anything = max > 0;

  if (!anything) {
    return (
      <div className="flex flex-1 flex-col justify-center" data-testid={testId}>
        <p
          className="rounded-md border border-dashed border-line-control px-3 py-8 text-center text-xs text-content-muted"
          data-testid={`${testId}-empty`}
        >
          {labels.empty}
        </p>
      </div>
    );
  }

  const axis = niceCountAxis(max);
  const shown = visibleLabelIndexes(points.length);
  const slot = BOX / points.length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-4 text-xs text-content-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-primary" />
          {labels.buyers}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-accent" />
          {labels.suppliers}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-stretch gap-2">
        <ul
          className="flex list-none flex-col-reverse justify-between text-[10px] leading-none text-content-muted"
          aria-hidden
        >
          {axis.ticks.map((tick) => (
            <li key={tick} className="tabular-nums">
              {compactNumber(tick, locale, labels.units)}
            </li>
          ))}
        </ul>

        <div
          dir="ltr"
          className="relative min-w-0 flex-1"
          style={{ minHeight: "7rem" }}
        >
          <svg
            viewBox={`0 0 ${BOX} ${BOX}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={labels.chart}
            focusable="false"
          >
            {axis.ticks.map((tick) => {
              const y = BOX - (tick / axis.ceiling) * BOX;
              return (
                <line
                  key={tick}
                  x1="0"
                  x2={BOX}
                  y1={y}
                  y2={y}
                  className="stroke-line"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {/* The columns are HTML, so their width is a real number of
              pixels rather than a percentage the stretch would distort
              into a slab on a wide card. */}
          {points.map((point, index) => (
            <button
              key={point.at}
              type="button"
              className="absolute bottom-0 top-0 flex items-end justify-center gap-0.5 focus-visible:outline focus-visible:outline-2"
              style={{
                insetInlineStart: `${index * slot}%`,
                width: `${slot}%`,
              }}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() =>
                setActive((current) => (current === index ? null : current))
              }
              onFocus={() => setActive(index)}
              onBlur={() =>
                setActive((current) => (current === index ? null : current))
              }
              data-testid={`${testId}-bucket-${index}`}
              aria-describedby={active === index ? tipId : undefined}
            >
              <span className="sr-only">
                {labels.bucketNames[index]} — {labels.buyers} {point.buyers},{" "}
                {labels.suppliers} {point.suppliers}
              </span>
              <span
                aria-hidden
                data-testid={`${testId}-buyers-${index}`}
                className="w-2.5 rounded-t-sm bg-primary sm:w-3"
                style={{ height: `${(point.buyers / axis.ceiling) * 100}%` }}
              />
              <span
                aria-hidden
                data-testid={`${testId}-suppliers-${index}`}
                className="w-2.5 rounded-t-sm bg-accent sm:w-3"
                style={{ height: `${(point.suppliers / axis.ceiling) * 100}%` }}
              />
            </button>
          ))}

          {active !== null ? (
            <Tooltip
              id={tipId}
              x={index01(active, points.length)}
              lines={[
                labels.bucketNames[active],
                bucketDateRange(points[active].at, granularity, locale) ?? "",
                `${labels.buyers}: ${points[active].buyers} · ${labels.suppliers}: ${points[active].suppliers}`,
              ]}
              testId={`${testId}-tooltip`}
            />
          ) : null}
        </div>
      </div>

      <XAxis
        names={labels.bucketNames}
        points={points.map((point) => point.at)}
        granularity={granularity}
        locale={locale}
        shown={shown}
        testId={`${testId}-axis`}
      />
    </div>
  );
}

/** The middle of a column's slot, as a percentage of the plot. */
function index01(index: number, count: number): number {
  return ((index + 0.5) / count) * BOX;
}

// -------------------------------------------------------------- parts

/**
 * The captions under a plot: what the bucket is called, and when it was.
 *
 * Laid out in the SAME grid the plot uses, so a caption sits under the
 * point it names at every width. Hidden captions keep their cell — they
 * are thinned for room, not removed from the sequence.
 */
function XAxis({
  names,
  points,
  granularity,
  locale,
  shown,
  testId,
}: {
  names: string[];
  points: string[];
  granularity: "daily" | "weekly";
  locale: AppLocale;
  shown: Set<number>;
  testId: string;
}) {
  return (
    <ol
      dir="ltr"
      data-testid={testId}
      className="grid list-none gap-0 text-center text-[10px] leading-tight text-content-muted"
      style={{
        gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
      }}
    >
      {points.map((at, index) => (
        <li key={at} className="min-w-0 px-0.5">
          {shown.has(index) ? (
            <>
              <span className="block truncate">{names[index]}</span>
              <span className="block truncate tabular-nums">
                {bucketDateRange(at, granularity, locale) ?? ""}
              </span>
            </>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** The exact figure, on hover and on focus alike. */
function Tooltip({
  id,
  x,
  lines,
  testId,
}: {
  id: string;
  /** Where the tooltip points, as a percentage across the plot. */
  x: number;
  lines: string[];
  testId: string;
}) {
  return (
    <div
      id={id}
      role="tooltip"
      data-testid={testId}
      // Clamped away from both edges so a tooltip on the first or last
      // bucket is not half outside the card.
      className={cn(
        "pointer-events-none absolute bottom-full z-10 mb-1 w-max max-w-[12rem] -translate-x-1/2",
        "rounded-md border border-line bg-surface px-2 py-1 text-start text-[11px] leading-snug text-content shadow-card",
      )}
      style={{ insetInlineStart: `${Math.min(85, Math.max(15, x))}%` }}
    >
      {lines
        .filter((line) => line !== "")
        .map((line) => (
          <span key={line} className="block tabular-nums">
            <bdi>{line}</bdi>
          </span>
        ))}
    </div>
  );
}

/**
 * The orders split, as one divided bar.
 *
 * THE THREE ARE EXCLUSIVE and sum to the paid total, so a single bar is
 * the honest shape: each segment is that stage's share of one whole.
 */
export function StatusBar({
  segments,
  testId,
}: {
  segments: readonly {
    key: string;
    label: string;
    count: number;
    tone: string;
  }[];
  testId: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div
        dir="ltr"
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-background"
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={segment.tone}
            style={{
              width: total === 0 ? "0%" : `${(segment.count / total) * 100}%`,
            }}
            aria-hidden
          />
        ))}
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="flex min-w-0 flex-col items-center gap-0.5"
          >
            <dt className="inline-flex min-w-0 items-center gap-1.5 text-xs text-content-muted">
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${segment.tone}`}
              />
              <span className="truncate">{segment.label}</span>
            </dt>
            <dd
              className="text-lg font-semibold leading-tight text-content tabular-nums"
              data-testid={`${testId}-${segment.key}`}
            >
              <bdi>{segment.count}</bdi>
            </dd>
            <dd className="text-xs leading-tight text-content-muted tabular-nums">
              <bdi>
                {total === 0
                  ? "0%"
                  : `${Math.round((segment.count / total) * 100)}%`}
              </bdi>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
