"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The parts every long form in this app needs, and nothing more.
 *
 * Deliberately small: a section wrapper, an error summary, and one hook
 * that warns before a browser-level navigation discards unsaved work.
 * There is no form library, no schema runtime and no generic field
 * factory — the product form is the only long form so far, and building an
 * abstraction for one caller would fix its shape before a second one has
 * argued with it.
 */

export interface FormSectionProps {
  /** Already translated. Renders as the section's accessible name. */
  title: string;
  children: ReactNode;
  className?: string;
  /**
   * How many columns the fields sit in on a wide screen.
   *
   * ONE BY DEFAULT, so nothing that does not ask changes. It is asked
   * for because four numbers — a weight and three dimensions — were each
   * given a whole row, and neither portal caps its content width: on a
   * wide monitor that is four stripes across the window to hold «12.5».
   *
   * ALWAYS ONE COLUMN ON A PHONE. The breakpoint is `sm`, so a narrow
   * screen keeps the single column it needs and nothing scrolls
   * sideways.
   */
  columns?: 1 | 2 | 3 | 4;
}

/**
 * Written out rather than interpolated: Tailwind reads class names as
 * literal strings at build time, and `sm:grid-cols-${n}` produces no CSS
 * at all — the section would silently stay one column.
 */
const COLUMN_CLASSES: Record<1 | 2 | 3 | 4, string> = {
  1: "flex flex-col gap-4",
  2: "grid gap-4 sm:grid-cols-2",
  3: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * One titled group of fields.
 *
 * A real `<section>` with an `aria-labelledby` heading rather than a styled
 * `<div>`: a screen-reader user navigating by landmark or heading gets the
 * same structure a sighted reader gets from the spacing.
 *
 * IT TAKES NO DESCRIPTION, and that is the point rather than an
 * omission. A sentence under a heading saying again what the heading
 * said is the shape the owner banned platform-wide; removing the PROP
 * means the next section cannot carry one by accident. If a section
 * genuinely needs a sentence, it is not a description of the section —
 * it is content, and belongs in the body with everything else.
 */
export function FormSection({
  title,
  children,
  className,
  columns = 1,
}: FormSectionProps) {
  const headingId = `section-${title.replace(/\s+/g, "-")}`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-4 rounded-card bg-surface shadow-card px-card-x py-card-y", className)}
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold text-content">
          {title}
        </h2>
      </div>
      <div className={COLUMN_CLASSES[columns]}>{children}</div>
    </section>
  );
}

export interface SummaryEntry {
  /** DOM id of the control (or panel) this entry points at. */
  targetId: string;
  /** Already translated. */
  message: string;
}

export interface ErrorSummaryProps {
  title: string;
  entries: readonly SummaryEntry[];
  className?: string;
}

/**
 * Every problem, listed once, above the form.
 *
 * `role="alert"` with `aria-live="assertive"`, because it appears in
 * response to a submit the reader just made — they are waiting for it.
 *
 * Each entry is an anchor to the control it describes. Anchors rather than
 * buttons: they move focus AND the viewport, they work with the keyboard
 * and the browser's own "go back" behaviour, and a screen reader announces
 * them as the navigations they are.
 *
 * Rendering nothing when there is nothing wrong is deliberate. A summary
 * that is always present, empty most of the time, is a region readers learn
 * to skip.
 */
export function ErrorSummary({ title, entries, className }: ErrorSummaryProps) {
  if (entries.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      data-error-summary
      className={cn("flex flex-col gap-2 rounded-lg border border-danger bg-surface shadow-card px-card-x py-card-y", className)}
    >
      <p className="text-sm font-semibold text-danger-text">{title}</p>
      <ul className="flex list-disc flex-col gap-1 ps-5">
        {entries.map((entry) => (
          <li key={entry.targetId} className="text-sm">
            <a
              href={`#${entry.targetId}`}
              className="inline-flex items-center text-secondary underline hover:opacity-[var(--state-hover-opacity)]"
              onClick={(event) => {
                // Focus, not just scroll. An in-page anchor moves the
                // viewport but leaves focus behind unless the target is
                // focusable, and a keyboard user would then tab from the
                // top of the page.
                const target = document.getElementById(entry.targetId);
                if (target) {
                  event.preventDefault();
                  target.focus();
                  // Guarded: focus is what a keyboard follows, and losing
                  // the scroll must never cost it.
                  target.scrollIntoView?.({ block: "center" });
                }
              }}
            >
              {entry.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Warns before the BROWSER discards unsaved work.
 *
 * `beforeunload` only — reload, tab close, back out of the site. It covers
 * exactly the navigations the page cannot otherwise see, and the browser
 * shows its own text; the message is not ours to write.
 *
 * In-app navigation is NOT intercepted here. Next's router gives no
 * cancellable navigation event, and the way round it is to monkeypatch
 * `history.pushState` or the router itself — which breaks every other link
 * on the page in ways nobody tests. The form's own Cancel button asks
 * instead, which is where someone actually leaves a form deliberately.
 */
export function useUnsavedChangesWarning(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Required by older browsers to trigger the prompt. The string is
      // never displayed — every current browser shows its own wording.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled]);
}
