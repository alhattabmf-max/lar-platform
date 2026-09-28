"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Calendar, Info, RefreshCw } from "lucide-react";
import { DASHBOARD_PERIODS } from "@platform/types";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

/**
 * The period control, and the pieces every dashboard card is built from.
 *
 * THE PERIOD LIVES IN THE URL, like every other filter in this console.
 * That is what makes "open the orders detail with the period I was
 * looking at" a link rather than a piece of state to carry, and what
 * makes the browser's Back button return to the window a reader was on.
 *
 * CHANGING IT RELOADS THE WHOLE SCREEN. Every figure, every chart and
 * every list on these pages is measured over the same window; updating
 * one card and leaving the rest would put two different periods on one
 * screen with nothing to say which is which.
 *
 * ONE COMPACT ROW. The overview has to reach its last two cards inside
 * a single desktop screen, and the header is the first place that pays
 * for itself: the control, the comparison note, the timestamp and the
 * refresh sit on one line at the text size they already had.
 */

export interface PeriodPickerLabels {
  label: string;
  comparison: string;
  lastUpdated: string;
  refresh: string;
  options: Record<string, string>;
}

export function PeriodPicker({
  period,
  generatedAt,
  labels,
}: {
  period: string;
  /** Already formatted in the reader's locale. */
  generatedAt: string;
  labels: PeriodPickerLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
      data-testid="period-picker"
    >
      <div className="flex items-center gap-1.5">
        <Calendar className="size-4 shrink-0 text-content-muted" aria-hidden />
        <Select
          aria-label={labels.label}
          value={period}
          data-testid="period-select"
          // The chooser height comes from the system; this used to
          // set its own and came out three pixels short of every other
          // select on the page.
          className="py-1"
          onChange={(event) => {
            const next = new URLSearchParams(params.toString());
            next.set("period", event.target.value);
            // A new window is a new result set: page four of the last
            // thirty days is not page four of the last seven.
            next.delete("page");
            startTransition(() => {
              router.push(`${pathname}?${next.toString()}`, { scroll: false });
            });
          }}
        >
          {DASHBOARD_PERIODS.map((value) => (
            <option key={value} value={value}>
              {labels.options[value] ?? value}
            </option>
          ))}
        </Select>
      </div>

      <span className="inline-flex items-center gap-1 text-sm text-content-muted">
        <Info className="size-4 shrink-0" aria-hidden />
        {labels.comparison}
      </span>

      <span className="text-sm text-content-muted" data-testid="last-updated">
        {labels.lastUpdated} <bdi>{generatedAt}</bdi>
      </span>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={labels.refresh}
        disabled={pending}
        data-testid="refresh"
        onClick={() => startTransition(() => router.refresh())}
      >
        <RefreshCw
          className={pending ? "size-4 animate-spin" : "size-4"}
          aria-hidden
        />
      </Button>
    </div>
  );
}

/**
 * What a movement MEANS, which is not the same as its sign.
 *
 * More money taken is good news; more money refunded is not, and
 * colouring both green because the number went up is the dashboard
 * telling an operator the wrong thing in the most confident way
 * available to it.
 *
 *   `more-is-good`  order value, revenue, active companies
 *   `more-is-bad`   refunds
 *   `neutral`       supplier payable — a larger balance owed is the
 *                   consequence of more trade, not a success or a
 *                   failure, so it is reported without a verdict
 */
export type DeltaIntent = "more-is-good" | "more-is-bad" | "neutral";

/**
 * A change against the previous period.
 *
 * NULL IS AN EM DASH, not a zero. A period with no predecessor, or one
 * whose predecessor was nothing, has no percentage to report — and "0%"
 * would claim nothing moved when in truth nothing was known.
 *
 * ZERO IS A MEASUREMENT and prints as one, but carries NO ARROW: a
 * figure that did not move did not rise, and an upward arrow beside
 * "0%" is a contradiction on the same line.
 *
 * THE ARROW FOLLOWS THE SIGN; ONLY THE COLOUR FOLLOWS THE MEANING. A
 * reader who cannot separate the two greens still sees which way the
 * number went.
 */
export function Delta({
  value,
  intent = "more-is-good",
  testId,
}: {
  value: number | null;
  intent?: DeltaIntent;
  testId?: string;
}) {
  if (value === null) {
    return (
      <span className="text-xs text-content-muted" data-testid={testId}>
        —
      </span>
    );
  }

  const rose = value > 0;
  const fell = value < 0;

  const tone =
    intent === "neutral" || value === 0
      ? "text-content-muted"
      : (intent === "more-is-good") === rose
        ? "text-success"
        : "text-danger";

  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs", tone)}
      data-testid={testId}
      data-intent={intent}
      data-direction={rose ? "up" : fell ? "down" : "flat"}
    >
      {rose ? <ArrowUp className="size-3" aria-hidden /> : null}
      {fell ? <ArrowDown className="size-3" aria-hidden /> : null}
      <bdi>
        {rose ? "+" : ""}
        {value}%
      </bdi>
    </span>
  );
}

/**
 * One of the eight cards.
 *
 * THE SHAPE THE APPROVED DESIGN DRAWS: the icon at the leading edge,
 * the name beside it, and the figure on its OWN LINE with the
 * comparison on the line beneath. They used to share one line, which
 * produced «2,925.00 ر.س. —» — an amount and an em dash reading as a
 * single broken value.
 *
 * NO SPARKLINE. A twelve-pixel chart inside a card says less than the
 * arrow beside the number and takes the space the note underneath uses
 * to say something an operator can act on.
 */
export function MetricCard({
  icon,
  label,
  value,
  delta,
  deltaIntent,
  note,
  noteTone = "muted",
  noteDivider = false,
  accent = "plain",
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  /**
   * Already formatted: money with its symbol, counts as digits.
   *
   * A NODE, NOT A STRING. The riyal's official symbol has no Unicode
   * code point, so an amount is drawn rather than typed — and a
   * drawing does not fit in a string. Counts still arrive as text.
   */
  value: React.ReactNode;
  delta?: number | null;
  deltaIntent?: DeltaIntent;
  /** One short useful fact, e.g. how many orders that total is over. */
  note?: string;
  /**
   * `warning` is for a state an operator should act on, and is used
   * ONLY where the page has real evidence of one — never as a colour
   * chosen because a number looked large.
   */
  noteTone?: "muted" | "info" | "warning";
  /** The financial cards rule off their note; the operational ones do not. */
  noteDivider?: boolean;
  /** `accent` marks the platform's own revenue, as the design does. */
  accent?: "plain" | "accent" | "primary";
  testId: string;
}) {
  const top =
    accent === "accent"
      ? "border-t-2 border-t-accent"
      : accent === "primary"
        ? "border-t-2 border-t-primary"
        : "border-t border-t-line";

  const noteClass =
    noteTone === "warning"
      ? "text-warning-text"
      : noteTone === "info"
        ? "text-secondary"
        : "text-content-muted";

  return (
    <section
      data-testid={testId}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-md border border-line bg-surface p-3",
        top,
      )}
    >
      <div className="flex items-center gap-2">
        {/* The icon leads the row, so it sits on the right in Arabic
            and on the left in English with no branch in this file. */}
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-content-muted"
        >
          {icon}
        </span>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-center">
          <span className="w-full truncate text-xs text-content-muted">
            {label}
          </span>

          {/* `<bdi>` and not `dir`: `dir` would change the block's own
              alignment and put the figure at the opposite end of the
              card from its label. */}
          <span className="w-full truncate text-xl font-semibold text-content tabular-nums">
            <bdi>{value}</bdi>
          </span>

          {delta !== undefined ? (
            <Delta
              value={delta}
              intent={deltaIntent}
              testId={`${testId}-delta`}
            />
          ) : null}
        </div>
      </div>

      {note ? (
        <p
          data-testid={`${testId}-note`}
          className={cn(
            "truncate text-center text-xs",
            noteDivider && "border-t border-line pt-1.5",
            noteClass,
          )}
        >
          {note}
        </p>
      ) : null}
    </section>
  );
}
