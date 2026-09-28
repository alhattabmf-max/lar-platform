"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
export interface ActionRequiredRow {
  key: string;
  /** How many of this kind are waiting. Zero rows are not drawn. */
  count: number;
  /** Already translated — «طلبات بانتظار التجهيز». */
  text: string;
  /** The page that holds them. */
  href: string;
}

export interface ActionRequiredLabels {
  /** «إجراء مطلوب» — the shortcut's own name. */
  title: string;
  clear: string;
  /** Announced on the count, e.g. «حالات تحتاج إجراءً». */
  countLabel: string;
}

/**
 * «إجراء مطلوب» — the one shortcut that is always on screen.
 *
 * «انقل «يتطلب انتباهك» إلى اختصار تحت الشعار باسم «إجراء مطلوب»،
 * بالنص الكحلي وبجانبه العدد الحقيقي داخل مربع صغير بزوايا ناعمة
 * وخلفية برتقالية فاتحة. بدون سهم أو أيقونة إضافية. الضغط يعرض
 * الحالات. يبقى الاختصار ظاهرًا دائمًا، وعند عدم وجود حالات يعرض العدد
 * 0 بنفس الشكل والمكان، ولا يختفي.»
 *
 * IT WAS A PANEL ON ONE PAGE. The counts were a card on the supplier
 * dashboard, which meant somebody working through their orders had to
 * go back to the front door to learn that a dispute was waiting. It
 * stands beside the tabs now, on every page.
 *
 * AND IN BOTH PORTALS — «إجراء مطلوب لمّا يظهر في واجهة المشتري». What
 * differs between them is only WHAT is waiting, so the rows arrive
 * already built and already translated: this file counts them, draws
 * them, and knows nothing about orders or disputes.
 *
 * AND IT HIDES WHEN THERE IS NOTHING — «ليش ما نخفيه، وإذا صار فيه
 * إجراء مطلوب يظهر بجانب أيقونة الإشعارات». It used to show a zero on
 * every page that had nothing to report, which is a counter nobody
 * reads. It stands beside the bell now and only when it has something
 * to say, so its presence IS the message.
 *
 * PRESSING IT SHOWS THE STATES rather than going somewhere: which of
 * the three is waiting is the question, and answering it by navigating
 * would make a reader leave the page to find out whether they needed
 * to. Each state inside IS a link, to the page that holds it.
 */
export function ActionRequired({
  rows: given,
  labels,
  tone = "page",
}: {
  /** What is waiting, per kind — see `ActionRequiredRow`. */
  rows: readonly ActionRequiredRow[];
  labels: ActionRequiredLabels;
  /**
   * WHAT IT IS STANDING ON.
   *
   * `page` — the sheet's own light, where the name is the identity's
   * navy: «بالنص الكحلي».
   *
   * `band` — the narrow screen's navy bar, where that same navy would
   * be navy on navy. The name takes the token the platform pairs with
   * that fill instead; the COUNT does not change, because a pale orange
   * box with a dark figure reads on either ground.
   */
  tone?: "page" | "band";
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // A COUNT OF ZERO IS NOT A STATE. A row that says "0 disputes" is a
  // row that teaches people to stop reading the list.
  const rows = given.filter((row) => row.count > 0);

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  // A DISCLOSURE CLOSES WHAT OPENED IT: clicking away and Escape both
  // shut it, and Escape returns focus to the control that opened it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (total === 0) return null;

  return (
    <div ref={boxRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        data-testid="action-required"
        // NO ARROW AND NO SECOND GLYPH — «بدون سهم أو أيقونة إضافية».
        // The name and the number are the whole control.
        //
        // AND THE TARGET THE PLATFORM SETS, even with no fill: a thing
        // you can press is 32px tall here however it is painted.
        className={
          // BIGGER AND HEAVIER, because it was not being read — «كلمة
          // إجراء مطلوب ليست واضحة». It stands alone on the light ground
          // under a 121px mark, beside a strip of solid orange; at the
          // body size it read as a caption for the logo above it.
          "inline-flex min-h-control items-center gap-2 whitespace-nowrap rounded-control text-[0.9375rem] font-bold hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
          (tone === "band" ? "text-primary-foreground" : "text-primary")
        }
      >
        {labels.title}
        {/* THE REAL COUNT, in a small soft-cornered box on a pale
            orange — «العدد الحقيقي داخل مربع صغير بزوايا ناعمة وخلفية
            برتقالية فاتحة». The ground is the accent mixed down into the
            page's own white, so it is the identity's orange and not a
            second one, and the figure on it is the platform's text
            colour at full contrast. */}
        <span
          className="inline-flex min-w-6 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--color-accent)_22%,var(--color-surface))] px-1.5 py-0.5 text-xs font-bold tabular-nums text-content"
          data-testid="action-required-count"
        >
          {total}
        </span>
        <span className="sr-only">{labels.countLabel}</span>
      </button>

      {open ? (
        <div
          data-testid="action-required-panel"
          className="absolute z-50 mt-1 flex min-w-64 list-none flex-col gap-1 rounded-card border border-line bg-surface p-2 text-start shadow-overlay"
        >
          {rows.length === 0 ? (
            <p className="px-2 py-1 text-sm text-content-muted" data-testid="action-required-clear">
              {labels.clear}
            </p>
          ) : (
            rows.map((row) => (
              <Link
                key={row.key}
                href={row.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-3 rounded-control px-2 py-2 text-sm text-content hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                data-testid={`action-required-${row.key}`}
              >
                <span className="min-w-0 truncate">{row.text}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                  {row.count}
                </span>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
