"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@platform/types";
import { PORTAL_STRIP_SLOT } from "@/components/portal/portal-page-bar";

/**
 * «لوحة التحكم» — the title, the period, and the refresh.
 *
 * BOTH CONTROLS ACTUALLY WORK, which is the point of them being here
 * rather than in the server component above.
 *
 *   · THE PERIOD IS A URL PARAMETER, so a chosen window survives a
 *     reload, can be linked to, and is what the server reads. A period
 *     held in component state would be lost by the first refresh.
 *   · REFRESH RE-READS ON THE SERVER. `router.refresh()` re-runs the
 *     page's own read with the same parameters — it does not reload the
 *     document, so nothing else on the screen is thrown away.
 *
 * THE TIME IS FORMATTED BY THE SERVER and passed in: a formatter is a
 * function, and React refuses to serialise one across this boundary.
 *
 * IT IS ONE ROW, AND ONE ROW ONLY. Two faults made it three:
 *
 *   · A SENTENCE UNDER THE TITLE — «نبض تجارتك في مكان واحد» — said the
 *     same words to every supplier forever, which is the decoration the
 *     owner struck off the whole platform. It is gone, and with it the
 *     twenty pixels it pushed every figure down by.
 *   · THE PERIOD CHOOSER WAS FULL WIDTH. `Select` carries `w-full`
 *     because a chooser in a form column should fill it — but in this
 *     wrapping row that made it 100% of the row and threw it onto a
 *     line of its own, stretched across the screen. It is sized to its
 *     own content here, which is what put it back beside the refresh.
 *
 * Between them the head was eighty pixels tall for two short things.
 *
 * AND NOW IT IS NO ROWS AT ALL. «احذف الصف اللي أنا مصوّره وانقله
 * للشريط حق اللسان في الرئيسية» — the controls are rendered into the
 * open tab's own strip instead of standing above the cards, so the
 * dashboard begins at its first figure.
 *
 * A PORTAL, AND NOT A PROP THROUGH THE LAYOUT. Both controls need what
 * only this page has: the instant its figures were read, and the period
 * the reader chose. Passing either up to the chrome would put a second
 * copy of both somewhere they would eventually disagree; a portal moves
 * the RENDERED row and leaves the data exactly where it is read.
 *
 * AFTER MOUNT, because the slot is a DOM node and there is none on the
 * server. Until then this renders nothing but its heading, which is
 * what `sr-only` was already for.
 */

export interface DashboardHeaderLabels {
  title: string;
  lastUpdated: string;
  refresh: string;
  periods: Record<DashboardPeriod, string>;
  periodLabel: string;
}

export function DashboardHeader({
  period,
  generatedAtLabel,
  labels,
}: {
  period: DashboardPeriod;
  generatedAtLabel: string;
  labels: DashboardHeaderLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // THE SLOT, ONCE THE DOCUMENT HAS ONE. The strip is drawn by the
  // layout above this page, so the node exists by the time an effect
  // runs — but not while the server renders, which is why this waits.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(PORTAL_STRIP_SLOT));
  }, []);

  function choose(next: string) {
    const query = new URLSearchParams(params.toString());
    query.set("period", next);
    startTransition(() => router.replace(`${pathname}?${query.toString()}`));
  }

  const row = (
      <div className="flex flex-wrap items-center gap-3">
        {/* WHITE, NOT THE AMBER'S INK — the strip this row is portalled
            into is the identity's navy now, and `--color-on-accent`
            (#0f172a) measures 1.07:1 on it. */}
        <span className="text-xs text-primary-foreground" data-testid="last-updated">
          {labels.lastUpdated} {generatedAtLabel}
        </span>

        {/* THE SHARED CONTROLS, not hand-written ones. A button typed
            into a page gets none of the system's height, focus ring or
            disabled treatment, and a bare <select> gets none of the
            chooser's skin — which is why the design guards refuse
            both. */}
        {/* NO BOX ROUND IT — «ألغِ أي أزرار داخل مربع في أشرطة اللسان
            واكتفِ بالأيقونة». It carried the ghost's boundary, which is
            a box inside the band the strip already is. The variant with
            no paint at all keeps the height, the focus ring and the
            disabled treatment the system gives every button. */}
        <Button
          type="button"
          variant="bare"
          onClick={() => startTransition(() => router.refresh())}
          aria-label={labels.refresh}
          data-testid="dashboard-refresh"
        >
          <RefreshCw
            className={`size-4 ${pending ? "animate-spin" : ""}`}
            aria-hidden
          />
        </Button>

        {/* THE BOX AROUND IT IS WHAT SIZES IT, which is the same thing
            the console's own period picker does. The chooser skin
            carries `w-full` — right in a form column, and in a toolbar
            it meant 100% OF THE ROW, so the control wrapped onto a line
            of its own and stretched across the screen. Inside a flex
            box of its own, that 100% is 100% of the words in it.
            `cn` joins classes and does not merge them, so a `w-auto`
            written on the element would have lost to the skin's
            `w-full` in the stylesheet's own order. */}
        {/* AND IT STANDS AT THE BUTTON'S HEIGHT — «خلّه 32 بكسل
            ارتفاعه ووازنه مع الزر اللي جنبه». A chooser is 36px in a
            form column because it lines up with the fields around it;
            here it lines up with the refresh button instead, and 36
            beside 32 is two shapes that nearly agree, which reads
            worse than either alone. The height is a PROP rather than a
            class, for the same reason the width is a box: `cn` joins
            and does not merge, so `h-field` would have won. */}
        <span className="flex items-center">
          <Select
            value={period}
            onChange={(event) => choose(event.target.value)}
            heightAs="control"
            aria-label={labels.periodLabel}
            data-testid="dashboard-period"
          >
            {DASHBOARD_PERIODS.map((value) => (
              <option key={value} value={value}>
                {labels.periods[value]}
              </option>
            ))}
          </Select>
        </span>
      </div>
  );

  return (
    <>
      {/* THE TAB ABOVE IS THIS PAGE'S TITLE. The heading stays for the
          document outline — see the list pages for why — and it stays
          HERE, in the page's own tree, because that is where a reader
          walking the document expects the page's name. */}
      <h1 className="sr-only">{labels.title}</h1>
      {slot ? createPortal(row, slot) : null}
    </>
  );
}
