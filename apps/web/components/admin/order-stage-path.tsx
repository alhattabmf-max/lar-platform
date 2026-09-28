"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { AdminOrderStage, AdminOrderStageInsight } from "@platform/types";

/**
 * The four stages an order passes through, as the path it walks.
 *
 * PRESSING A STAGE FILTERS THE TABLE. That is the whole reason the path
 * is here rather than four more metric cards: the number and the rows
 * behind it are one gesture apart.
 *
 * `paid` IS THE TOTAL, and it is drawn first for that reason — every
 * order in the window, because `master_orders` cannot exist without a
 * successful payment. The three after it partition that same total, so
 * the arrows read as a journey rather than as an addition.
 *
 * PRESSING THE ACTIVE STAGE CLEARS THE FILTER, because the second press
 * of a toggle is how people undo the first.
 */

export interface StagePathLabels {
  title: string;
  hint: string;
  stages: Record<AdminOrderStage, string>;
  /**
   * What each stage's figure MEANS, e.g. «متوسط بدء التجهيز».
   *
   * Strings, never formatters. This component runs in the browser and
   * its props cross the server boundary, where React serialises every
   * one of them — and refuses a function:
   *
   *     Functions cannot be passed directly to Client Components
   *
   * Two of these used to be `(value: string) => string`, which made
   * this whole screen a 500 on every request. The figures they built
   * are derived from `insight` alone, so the page computes them and
   * passes the finished strings in `figures` below.
   */
  notes: Record<AdminOrderStage, string>;
  change: string;
}

const ORDER: readonly AdminOrderStage[] = [
  "paid",
  "inFulfilment",
  "completed",
  "troubled",
];

export function OrderStagePath({
  insight,
  activeStage,
  labels,
  figures,
  icons,
}: {
  insight: AdminOrderStageInsight;
  activeStage: string | null;
  labels: StagePathLabels;
  /**
   * Each stage's figure, ALREADY FORMATTED — a percentage, a span of
   * hours, a span of days, or an em dash where there is nothing to
   * report. Built on the server, where the message catalogue is.
   */
  figures: Record<AdminOrderStage, string>;
  icons: Record<AdminOrderStage, React.ReactNode>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const counts: Record<AdminOrderStage, number> = {
    paid: insight.paid,
    inFulfilment: insight.inFulfilment,
    completed: insight.completed,
    troubled: insight.troubled,
  };

  const tones: Record<AdminOrderStage, string> = {
    paid: "border-primary text-primary",
    inFulfilment: "border-accent text-accent-interactive",
    completed: "border-success text-success",
    troubled: "border-danger text-danger",
  };

  function select(stage: AdminOrderStage) {
    const next = new URLSearchParams(params.toString());
    // `paid` is the total, not a filter: pressing it means "show
    // everything", which is the absence of a stage.
    if (stage === "paid" || activeStage === stage) next.delete("stage");
    else next.set("stage", stage);
    next.delete("page");

    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y"
      data-testid="order-stage-path"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-content">{labels.title}</h2>
        {insight.changePercent !== null ? (
          <span className="text-xs text-content-muted tabular-nums">
            <bdi>
              {insight.changePercent >= 0 ? "+" : ""}
              {insight.changePercent}%
            </bdi>{" "}
            {labels.change}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-stretch gap-2">
        {ORDER.map((stage, index) => (
          <div
            key={stage}
            className="flex min-w-0 flex-1 basis-40 items-center gap-2"
          >
            <button
              type="button"
              onClick={() => select(stage)}
              aria-pressed={activeStage === stage}
              data-testid={`stage-${stage}`}
              className={[
                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md border-2 px-3 py-3",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                activeStage === stage
                  ? tones[stage]
                  : `${tones[stage]} opacity-70`,
                "hover:opacity-100",
              ].join(" ")}
            >
              <span aria-hidden>{icons[stage]}</span>
              <span className="text-xs text-content-muted">
                {labels.stages[stage]}
              </span>
              <span className="text-xl font-semibold text-content tabular-nums">
                <bdi>{counts[stage]}</bdi>
              </span>
            </button>

            {/* The arrow points the way the reader is travelling; the
                document's own direction turns it over for English. */}
            {index < ORDER.length - 1 ? (
              <ChevronLeft
                aria-hidden
                className="size-4 shrink-0 text-content-muted ltr:rotate-180"
              />
            ) : null}
          </div>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ORDER.map((stage) => (
          <div
            key={stage}
            className="flex min-w-0 flex-col items-center gap-0.5 text-center"
          >
            <dt className="text-xs text-content-muted">
              {labels.notes[stage]}
            </dt>
            <dd
              className="text-sm font-medium text-content tabular-nums"
              data-testid={`stage-note-${stage}`}
            >
              <bdi>{figures[stage]}</bdi>
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-content-muted">{labels.hint}</p>
    </section>
  );
}
