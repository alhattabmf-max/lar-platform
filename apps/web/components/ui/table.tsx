import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Table shell.
 *
 * The wrapper scrolls horizontally on its own (`overflow-x-auto`) and is
 * focusable with `tabIndex={0}`, so a keyboard user can reach and scroll
 * a wide table — without this, table content past the viewport edge is
 * unreachable without a mouse. The page body itself never scrolls
 * horizontally, which is what keeps 360px viable.
 *
 * `caption` is required: an unnamed data table is unusable with a screen
 * reader. Callers pass a translated string.
 */
export interface TableProps {
  caption: ReactNode;
  /** Visually hide the caption while keeping it for assistive tech. */
  captionHidden?: boolean;
  children: ReactNode;
  className?: string;
  /** Inside a card that already carries the lift: no shadow, a hairline instead. */
  flush?: boolean;
}

export function Table({
  caption,
  captionHidden = true,
  children,
  className,
  flush = false,
}: TableProps) {
  return (
    <div
      tabIndex={0}
      role="group"
      // RAISED CONTAINER, FLAT ROWS. A row that lifted would read as a
      // control; the lift belongs to the surface holding them.
      //
      // UNLESS IT IS ALREADY INSIDE ONE. A raised card drawn on a raised
      // card is the second container this design has been striking off
      // all along — so a table that is one section of a record keeps the
      // scroller and gives up the lift.
      className={cn(
        "w-full overflow-x-auto",
        flush ? "rounded-card border border-line" : "rounded-card bg-surface shadow-card",
      )}
    >
      <table className={cn("w-full border-collapse text-sm", className)}>
        <caption className={cn(captionHidden ? "sr-only" : "px-4 py-3 text-start text-content-muted")}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

/**
 * THE HEAD IS DARK, AND THE ROWS ALTERNATE UNDER IT.
 *
 * «الجداول باهتة، اجعلها بنفس الهوية حقّت جدول بيانات المنشأة في
 *  صفحة المورد: عنوان داكن وصفّ أبيض واللي بعده رمادي.»
 *
 * IT WAS `bg-background` ON WHITE — a head two per cent away from
 * the rows under it, which is not a heading, it is a rumour. The
 * record card had already answered this: its first row is the
 * identity's navy with white on it, and every label strip under
 * that is the same navy at seven per cent.
 *
 * SO THE TABLE BORROWS ITS OWN PLATFORM'S ANSWER rather than
 * inventing a second one. White on the navy measures 15.7:1; the
 * seven-per-cent tint is the same stripe the record card stands its
 * labels on.
 *
 * AND IT IS PLAIN WHERE THE CARD ALREADY CARRIES A DARK BAND.
 *
 * «هذي جايه كأنها جداول في بطاقة، خلّها جدول واحد» — a record card
 * whose identity strip is navy, holding two tables each with a navy head
 * of its own, reads as three tables stacked rather than as one record.
 * The supplier's own «بيانات المنشأة» is the model: ONE dark band at the
 * top, and everything under it divided by hairlines.
 *
 * So the plain head keeps the SAME seven-per-cent tint the rows already
 * stripe with — it is a label strip, not a second heading — and the
 * cell rules under it become the page hairline, because white dividers
 * exist only to be visible on navy.
 */
export function THead({
  children,
  appearance = "dark",
}: {
  children: ReactNode;
  appearance?: "dark" | "plain";
}) {
  return (
    <thead
      className={
        appearance === "plain"
          ? "bg-[color-mix(in_srgb,var(--color-primary)_7%,var(--color-surface))] " +
            "[&_th]:border-line [&_th]:text-content-muted"
          : "bg-primary"
      }
    >
      {children}
    </thead>
  );
}

/**
 * THE ROWS AND THE LINES BETWEEN THEM.
 *
 * ASKED OF THE BODY, NOT OF A ROW. `TR` is used inside `THead` as
 * well, so a background set there painted straight over the dark
 * head — «وين العنوان الكحلي الداكن؟» — and every table came back
 * white. A `tbody` selector cannot reach the head by construction.
 *
 * AND THE LINES ARE BACK — «وين خطوط الجدول؟» I took them off with
 * the stripe, reasoning that two grounds already have an edge. They
 * do, but the record card this skin comes from draws BOTH: its
 * cells sit on a line-coloured ground with a one-pixel gap, so every
 * cell is boxed. A stripe says which row; a line says where a row
 * ends.
 */
export function TBody({ children }: { children: ReactNode }) {
  return (
    <tbody
      className={
        "[&>tr]:bg-surface [&>tr]:border-b [&>tr]:border-line " +
        "[&>tr:last-child]:border-b-0 " +
        "[&>tr:nth-child(even)]:bg-[color-mix(in_srgb,var(--color-primary)_7%,var(--color-surface))]"
      }
    >
      {children}
    </tbody>
  );
}

/**
 * A ROW, AND NOTHING ELSE.
 *
 * IT CARRIED THE STRIPE FOR ONE BUILD and painted the dark head
 * white, because `THead` wraps its cells in one of these too. What
 * a row stands on is `TBody`'s answer now.
 */
export function TR({ children }: { children: ReactNode }) {
  return <tr>{children}</tr>;
}

export function TH({ children, scope = "col" }: { children: ReactNode; scope?: "col" | "row" }) {
  return (
    <th
      scope={scope}
      // TIGHTER — «قلّل الحشو حقّ الصفوف لأنها كبيرة». Ten pixels
      // above and below became six: a console is read by scanning
      // many rows, and every pixel of air is a row that did not fit
      // on the screen.
      //
      // AND WHITE, because the head is the identity's navy now.
      className={
        // THE HEAD PARTS ITS OWN COLUMNS IN WHITE, not in the page
        // hairline: a light grey line on the identity navy is a line
        // nobody can see. Twenty-eight per cent is the same mix the
        // rows of names use between themselves.
        "border-e px-4 py-1.5 text-start font-semibold " +
        "border-[color-mix(in_srgb,var(--color-on-primary)_28%,transparent)] " +
        "text-primary-foreground last:border-e-0"
      }
    >
      {children}
    </th>
  );
}

export function TD({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td
      className={cn(
        "border-e border-line px-4 py-1.5 text-start text-content last:border-e-0",
        className,
      )}
    >
      {children}
    </td>
  );
}
