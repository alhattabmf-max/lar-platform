import type { CSSProperties } from "react";
import type { AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/cn";

/**
 * How much of an offer's supply has sold, and when it closes.
 *
 * THREE PIECES PLUS A COMPOSITION. The marker, the track and the
 * captions are exported separately because the card does not stack them
 * one under another: it lays them into rows it SHARES with its
 * information column, so that the bar ends level with the action button
 * beside it. The detail page has no second column to align to and takes
 * the composed `OfferProgress`, which stacks them exactly as before.
 *
 * The parts are shared rather than reimplemented because the things
 * that must never diverge between the two — which way the bar fills,
 * where the marker sits, what colour the fill is, how the percentage is
 * clamped — all live inside them. Only the arrangement differs, and
 * arrangement is the caller's business.
 *
 * It is NOT "collected". `progressPercentage` is the share of the
 * SUPPLY CAP already sold; the cap is not a funding goal and reaching
 * it unlocks nothing. The copy says "sold", and there is deliberately
 * no "collected so far" line — the bar already shows that.
 *
 * The marker tracks the real percentage. A fixed position would be a
 * decoration pretending to be data.
 */
export interface OfferProgressLabels {
  /** e.g. "90% remaining" — already interpolated by the caller. */
  remaining: string;
  /** e.g. "Offer ends: 6 September 2026" — already interpolated. */
  endsAt: string;
  /** Accessible description of the bar, already interpolated. */
  ariaLabel: string;
}

export interface OfferProgressProps {
  /** 0–100. Clamped defensively; the API already clamps the quantity. */
  progressPercentage: number;
  locale: AppLocale;
  labels: OfferProgressLabels;
  /**
   * Print the closing date under the bar.
   *
   * On by default, which is what the detail page uses. The CARD turns
   * it off and renders the date in its information column instead.
   */
  showEndsAt?: boolean;
}

/** Whole percent, inside 0–100. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function dirOf(locale: AppLocale): "rtl" | "ltr" {
  return locale === "ar-SA" ? "rtl" : "ltr";
}

interface PieceProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * The percentage and its arrow, riding on the filled end of the bar.
 *
 * Carries its own `dir` rather than inheriting one. Each piece can be
 * dropped into a grid whose direction was pinned for layout reasons —
 * the card does exactly that — and `inset-inline-start` resolves
 * against the element's OWN direction, so without this the marker would
 * measure from the wrong edge.
 */
export function OfferProgressMarker({
  progressPercentage,
  locale,
  className,
  style,
}: { progressPercentage: number; locale: AppLocale } & PieceProps) {
  const percent = clampPercent(progressPercentage);

  return (
    <div
      dir={dirOf(locale)}
      className={cn("relative h-8", className)}
      style={style}
      data-testid="offer-progress-marker-row"
    >
      <div
        className="absolute bottom-0 flex w-4 flex-col items-center"
        style={{ insetInlineStart: `calc(${percent}% - 0.5rem)` }}
        data-testid="offer-progress-marker"
        aria-hidden="true"
      >
        <span className="text-xs font-semibold text-content">{percent}%</span>
        <span className="text-[10px] leading-none text-content">▼</span>
      </div>
    </div>
  );
}

/**
 * The track and its filled portion.
 *
 * The fill grows from the READING EDGE — right in Arabic, left in
 * English — because it is a block child of a `dir`-scoped box, which is
 * also why the `dir` belongs here rather than on some ancestor.
 */
export function OfferProgressTrack({
  progressPercentage,
  locale,
  ariaLabel,
  className,
  style,
}: {
  progressPercentage: number;
  locale: AppLocale;
  ariaLabel: string;
} & PieceProps) {
  const percent = clampPercent(progressPercentage);

  return (
    <div
      dir={dirOf(locale)}
      className={cn(
        "h-2.5 w-full overflow-hidden rounded-full bg-line",
        className,
      )}
      style={style}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      {/* A fixed orange, per the reference — it does not shift colour
          with the value, because the value is not a health signal.
          `accent` is the approved amber; as a graphical object rather
          than text it is held to the 3:1 non-text rule, which it
          clears against the track. */}
      <div
        className="h-full rounded-full bg-accent transition-[width]"
        style={{ width: `${percent}%` }}
        data-testid="offer-progress-fill"
      />
    </div>
  );
}

/**
 * The composed bar: marker, track, then the two captions on one row.
 *
 * This is the DETAIL PAGE's arrangement. The card composes the same
 * pieces itself, into rows it shares with the column beside it.
 */
export function OfferProgress({
  progressPercentage,
  locale,
  labels,
  showEndsAt = true,
}: OfferProgressProps) {
  return (
    <div
      className="flex w-full flex-col gap-1"
      dir={dirOf(locale)}
      data-testid="offer-progress"
    >
      <OfferProgressMarker
        progressPercentage={progressPercentage}
        locale={locale}
      />
      <OfferProgressTrack
        progressPercentage={progressPercentage}
        locale={locale}
        ariaLabel={labels.ariaLabel}
      />

      {/*
        THE TWO CAPTIONS ARE PLACED, NOT ORDERED.

        The closing date sits at the reading-start edge (right in
        Arabic, left in English) and the remaining share at the far
        edge. Their DOM order is the opposite of their visual order on
        purpose: "remaining" belongs to the bar and is read straight
        after it, while placement decides where each one lands. Relying
        on source order would mean a future edit that reorders the JSX
        for readability silently flips the layout, and in RTL that is
        not a cosmetic difference — it puts the deadline where the eye
        does not start.

        `gridColumn` is explicit and direction-aware: column 1 is the
        start edge in both directions, so neither branch nor locale
        check is needed.

        The tracks are sized to their CONTENT and pushed apart, not cut
        into two equal halves, so a long closing date keeps its line
        instead of wrapping while the short label beside it stays on
        one.
      */}
      <div
        className="grid grid-cols-[minmax(0,auto)_minmax(0,auto)] items-center justify-between gap-1 text-[11px]"
        data-testid="offer-progress-footer"
      >
        <span
          className="justify-self-end text-content-muted"
          style={{ gridColumn: 2 }}
          data-testid="offer-progress-remaining"
          data-edge="end"
        >
          {labels.remaining}
        </span>
        {/* The closing date carries the urgency, so it is the one red
            thing on the card. `danger` is the approved red. */}
        {showEndsAt ? (
          <span
            className="justify-self-start font-medium text-danger"
            style={{ gridColumn: 1 }}
            data-testid="offer-progress-ends-at"
            data-edge="start"
          >
            {labels.endsAt}
          </span>
        ) : null}
      </div>
    </div>
  );
}
