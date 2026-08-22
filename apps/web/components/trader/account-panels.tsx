import type { ReactNode } from "react";

/**
 * Presentation for the read-only account pages.
 *
 * Data is shown as labelled facts, never as a JSON dump — a person
 * reading their own bank details should not have to parse braces.
 *
 * Two rules are enforced by construction rather than by care:
 *
 *  - `MaskedValue` shows only a suffix. An IBAN is never rendered in
 *    full, and the component receives ONLY the last four characters,
 *    so a full value cannot leak through it even by mistake.
 *  - Coordinates are never a primary display. A location is its name
 *    and address; latitude and longitude mean nothing to a reader and
 *    are simply not passed in.
 */

export function FactList({ children }: { children: ReactNode }) {
  return <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>;
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-content-muted">{label}</dt>
      <dd className="text-sm text-content">{value}</dd>
    </div>
  );
}

/**
 * A masked identifier.
 *
 * Takes the visible SUFFIX only — never the full value with a
 * instruction to hide part of it. The caller cannot pass a whole IBAN
 * here and rely on this to trim it, because there is nothing to trim.
 */
export function MaskedValue({ last4, srLabel }: { last4: string; srLabel: string }) {
  return (
    <span className="font-mono">
      <span aria-hidden="true">•••• •••• •••• {last4}</span>
      <span className="sr-only">
        {srLabel} {last4}
      </span>
    </span>
  );
}

/**
 * A status with the next step spelled out.
 *
 * A bare "PENDING" tells someone nothing about what to do. `action` is
 * required, not optional, so a status can never ship without one.
 */
export function StatusWithAction({
  label,
  status,
  action,
  tone = "neutral",
}: {
  label: string;
  status: string;
  action: string;
  tone?: "neutral" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning bg-warning-surface text-warning-text"
      : tone === "success"
        ? "border-success text-content"
        : "border-line text-content";

  return (
    <div className={`flex flex-col gap-1 rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium">{status}</p>
      <p className="text-sm">{action}</p>
    </div>
  );
}
