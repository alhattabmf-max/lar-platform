"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * THE PARTS THE PRODUCT CARDS ARE DRAWN FROM.
 *
 * Lifted out of `listing-form` unchanged, because a SECOND screen now
 * draws the same cards: the console's product page — «استخدم بطاقة
 * إضافة المنتج في صفحة المورد نفس ترتيبها بالضبط». A copy of these
 * three would be the place the two screens quietly stop matching.
 *
 * They stay presentational: no state, no fetch, no message catalogue.
 * Every caller passes its own words in.
 */

/**
 * The NAME of a value, in the same type as a field's label.
 *
 * NOT A `<label>`. That element promises a control to focus and
 * hands a screen reader a form field that is not there; these rows
 * carry a value, so the name is a plain span wearing the same type.
 */
export function ReadName({ children }: { children: ReactNode }) {
  return <span className="text-sm font-medium text-content">{children}</span>;
}

/**
 * A VALUE WHERE A FIELD WOULD BE — the same card, reading rather
 * than writing.
 *
 * «اجعل عرض تفاصيل المنتج نفس بطاقة إضافة منتج بالضبط.» The detail
 * page draws the very cards the add form draws, in the same order and
 * the same grid, and the only difference is that these boxes are read
 * instead of typed. Same border, same height, same rounding, so the
 * two screens line up column for column.
 *
 * NOT A DISABLED INPUT. A disabled control is still a control: it
 * takes a tab stop away, greys the text a reader came to read, and
 * tells a screen reader there is something here that cannot be used.
 * This is a value, and it says so.
 *
 * AN EMPTY ONE IS AN EM DASH, never a blank box — a box with nothing
 * in it reads as a field somebody forgot to fill.
 */
export function ReadValue({
  children,
  dir,
  multiline,
}: {
  children?: ReactNode;
  dir?: "rtl" | "ltr";
  /** A description keeps its line breaks and its height. */
  multiline?: boolean;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <p
      dir={dir}
      className={cn(
        "block w-full rounded-control border border-line-control bg-surface",
        "px-control-x text-[length:var(--control-font-size)]",
        "leading-[var(--control-line-height)] text-content",
        multiline
          ? "min-h-field whitespace-pre-line py-control-y"
          : "flex h-field items-center",
        empty && "text-content-muted",
      )}
    >
      {empty ? "—" : children}
    </p>
  );
}

/** Half a row in the six-column selling card. */
export const HALF6 = "col-span-6 sm:col-span-3";
/** A third of a row in the six-column selling card. */
export const THIRD6 = "col-span-6 sm:col-span-2";
/**
 * Half a row in the twelve-column card — TWO across, not four. Four
 * fitted when the name sat above the box; beside it, four leave the box
 * about a hundred pixels and it collapses.
 */
export const HALF12 = "col-span-12 sm:col-span-6";
/** The short names in those cards: «الوزن (كجم)», «مدة العرض (يوم)». */
export const SHORT_LABEL = "sm:w-24";
/**
 * A card's title, with the mark the reference draws beside it.
 *
 * THE MARK IS DECORATION AND CARRIES `aria-hidden`. A turquoise tag
 * over «بيانات المنتج» tells a sighted reader which card they are in
 * at a glance; it tells a screen-reader user nothing the heading does
 * not already say, and announcing "tag" before it would be noise.
 *
 * AT MODULE SCOPE, like the field helper below and for the same
 * reason: a component declared inside `ListingForm` is a NEW function
 * identity on every render, and to React a function identity IS a
 * component type — so every keystroke would unmount and rebuild
 * everything under it.
 */
export function SectionTitle({
  icon,
  children,
  aside,
}: {
  icon: ReactNode;
  children: ReactNode;
  /**
   * What rides at the far end of the title row.
   *
   * «خلّ الرسم التوضيحي موازيًا لاسم البطاقة، فوق، عشان أقلّل
   * الحشو في البطاقتين من تحت.»
   *
   * A card's footnote — a worked example, a drawing of what the
   * numbers mean — costs a block at the BOTTOM, and the bottom of
   * a card is what decides how tall the card is. The title row is
   * already there and is mostly empty, so a note that rides on it
   * costs nothing at all.
   */
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-control-gap gap-y-1">
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <h2 className="text-base font-semibold text-content">{children}</h2>
      {aside ? (
        <div className="ms-auto flex items-center gap-3">{aside}</div>
      ) : null}
    </div>
  );
}

/**
 * The parcel the reference draws under the shipping fields.
 *
 * IT IS THE SENTENCE BESIDE IT, IN A PICTURE: weight and dimensions
 * are of the sales unit AFTER it is packed, and a box with a height
 * arrow and two floor arrows says that faster than the line of text
 * can. Decorative, so `aria-hidden` — the text carries the meaning.
 *
 * DRAWN RATHER THAN IMPORTED. No icon set ships a dimensioned parcel,
 * and the two colours are the point: the box is the accent, the arrows
 * are the muted text colour, exactly as the reference has them.
 */
export function ParcelMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 104 90"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g
        className="text-accent"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M14 26 52 8 90 26 52 44Z" />
        <path d="M14 26v32l38 18V44" />
        <path d="M90 26v32L52 76" />
        <path d="M33 17 71 35" />
      </g>
      <g
        className="text-content-muted"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* height */}
        <path d="M97 30v28" />
        <path d="M94 34 97 30l3 4" />
        <path d="M94 54 97 58l3-4" />
        {/* depth */}
        <path d="M12 64 46 80" />
        <path d="M16.5 69.4 12 64l7 0" />
        <path d="M41.5 74.6 46 80l-7 0" />
        {/* width */}
        <path d="M58 80 92 64" />
        <path d="M65 80h-7l4.5-5.4" />
        <path d="M85 64h7l-4.5 5.4" />
      </g>
    </svg>
  );
}

/**
 * THE LABEL BESIDE ITS CONTROL, not above it.
 *
 * The owner's instruction: «استبدل مكان التسمية من فوق الحقل إلى جانب
 * الحقل تكون موازية له». A stacked label costs a row of its own per
 * field, and on a card asking six or seven questions that is six or
 * seven rows of the page spent on words that could sit beside the boxes
 * they name.
 *
 * THE LABEL COLUMN IS A FIXED WIDTH, so every control in a card starts
 * at the same place and the boxes read as one column rather than a
 * ragged edge. It wraps rather than truncating — a name cut off is a
 * question nobody can answer.
 *
 * IT STACKS BELOW the small breakpoint. A phone has no room for two
 * columns inside a cell that is already half the screen, and a label
 * squeezed to four characters is worse than a label above the box. The
 * instruction is about the shape of the form on a screen that holds it.
 *
 * THE CONTROL HAS A FLOOR, AND THE ROW WRAPS BELOW IT. Four fields
 * across a card five columns wide leave about a hundred pixels each —
 * and a fixed label beside a control with no minimum ate every one of
 * them, leaving a box too narrow to hold a digit. That is what the
 * owner reported. The control now declares the narrowest it may become
 * and the row is allowed to wrap, so a cell that genuinely cannot hold
 * both puts the label back on its own line instead of crushing the
 * answer. The cure for the card in the report is the width below, not
 * this — this is the floor under every cell, so it cannot happen again
 * on a card nobody thought to measure.
 *
 * THE LABEL COLUMN IS NARROWER WHERE THE LABELS ARE SHORT. «الوزن
 * (كجم)» does not need the room «وحدة المحتوى بالعربية» does, and
 * spending it anyway is what left the box with nothing.
 *
 * THE ERROR KEEPS THE CONTROL'S COLUMN. Under the label it would point
 * at the name rather than at the answer, so it is given the same
 * indent by an empty spacer rather than by a hand-measured margin.
 *
 * AT MODULE SCOPE, like the two marks above and for the same reason: a
 * component declared inside `ListingForm` is a new function identity
 * every render, and React would rebuild every field on every keystroke.
 */
export function FieldRow({
  label,
  control,
  error,
  className,
  labelWidth = "sm:w-28",
}: {
  label: ReactNode;
  control: ReactNode;
  error?: ReactNode;
  className?: string;
  /** How much room the name needs. Narrower where the names are short. */
  labelWidth?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center gap-x-control-gap gap-y-1">
        <div className={cn("w-full sm:shrink-0", labelWidth)}>{label}</div>
        <div className="w-full min-w-[9rem] flex-1 sm:w-auto">{control}</div>
      </div>
      {error ? (
        <div className="flex flex-wrap gap-x-control-gap">
          <span
            aria-hidden="true"
            className={cn("hidden sm:block sm:shrink-0", labelWidth)}
          />
          <div className="w-full min-w-[9rem] flex-1 sm:w-auto">{error}</div>
        </div>
      ) : null}
    </div>
  );
}
