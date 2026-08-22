import { cn } from "@/lib/cn";

/**
 * A status, translated and toned.
 *
 * The API's statuses are machine vocabularies — `AWAITING_PREPARATION`,
 * `RESOLVED_PARTIAL` — and showing one raw asks a reader to decode an
 * enum. Every one is translated through its own message key.
 *
 * The tone is deliberately narrow. `attention` is for a state where
 * something is wrong or someone is waiting on the trader; `done` for a
 * finished one; `neutral` for everything in between. Colouring routine
 * progress would make the genuinely urgent indistinguishable, and
 * colour is never the only signal — the label always says it too.
 */
export type StatusTone = "neutral" | "attention" | "done";

export function StatusBadge({
  label,
  tone = "neutral",
  className,
}: {
  /** Already translated. Never a raw enum value. */
  label: string;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-md border px-2 py-0.5 text-xs font-medium",
        tone === "attention"
          ? "border-warning bg-warning-surface text-warning-text"
          : tone === "done"
            ? "border-success text-content"
            : "border-line text-content-muted",
        className
      )}
    >
      {label}
    </span>
  );
}

/**
 * Which allocation states need someone to act or to know.
 *
 * `DELIVERED` is done. Everything else is in progress and reads
 * neutral — a shipment that is simply moving is not a problem, and
 * marking it as one would devalue the marker.
 */
export function allocationTone(status: string, overdue: boolean): StatusTone {
  if (overdue) return "attention";
  return status === "DELIVERED" ? "done" : "neutral";
}

/**
 * Dispute tone.
 *
 * The four `RESOLVED_*` outcomes are NOT equivalent: an accepted
 * refund and a rejection are opposite results. Only the rejection is
 * toned for attention, and the label always names the exact outcome —
 * collapsing them into "Resolved" would hide which one occurred.
 */
export function disputeTone(status: string): StatusTone {
  if (status === "RESOLVED_REJECTED") return "attention";
  if (status.startsWith("RESOLVED_")) return "done";
  return "neutral";
}

/** A failed replacement is the only state here that needs chasing. */
export function replacementTone(status: string): StatusTone {
  if (status === "FAILED") return "attention";
  return status === "DELIVERED" ? "done" : "neutral";
}
