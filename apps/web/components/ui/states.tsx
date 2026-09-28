import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Loading, empty and error states.
 *
 * All copy arrives already translated from the caller. The skeleton is
 * `aria-hidden` with a separate visually-hidden live message, so a
 * screen reader hears "loading" once instead of reading a wall of
 * decorative boxes.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      // A SHADE OF THE HAIRLINE, not the hairline itself. The rule got
      // darker so a divider could be seen; a skeleton is a whole block
      // of it, and at full strength six of them stacked read as
      // content that has already arrived.
      className={cn(
        "animate-pulse rounded-control bg-[color-mix(in_srgb,var(--color-border)_60%,var(--color-surface))]",
        className
      )}
    />
  );
}

export interface LoadingStateProps {
  /** Translated, e.g. "Loading…" — announced politely. */
  label: string;
  rows?: number;
  className?: string;
}

export function LoadingState({ label, rows = 3, className }: LoadingStateProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <span role="status" aria-live="polite" className="sr-only">
        {label}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      // A WELL, NOT A SECOND FRAME — «ما هو تسوي لي داخل البطاقة
      // إطار». This box wore the 3:1 boundary for one revision, and on
      // a card it then read as the card's edge while the real edge
      // stayed invisible: two frames arguing about which one was the
      // container. The card took the strong line, so this gives it up.
      //
      // WHAT DOES THE WORK NOW IS THE FILL. An empty state holds two
      // lines of centred text and nothing else, so it has to be
      // visibly a REGION; a value change says that without drawing a
      // competing rectangle, and the dashed hairline only traces it.
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-line",
        "bg-field-fill px-6 py-10 text-center",
        className
      )}
    >
      <p className="text-base font-medium text-content">{title}</p>
      {description ? <p className="text-sm text-content-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title: string;
  description?: string;
  /** Shown verbatim for support. Never accompanied by internal `details`. */
  requestId?: string | null;
  /** Translated label preceding the request id, e.g. "Reference". */
  requestIdLabel?: string;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  title,
  description,
  requestId,
  requestIdLabel,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-danger",
        "bg-surface px-6 py-10 text-center",
        className
      )}
    >
      <p className="text-base font-medium text-content">{title}</p>
      {description ? <p className="text-sm text-content-muted">{description}</p> : null}
      {requestId ? (
        <p className="text-xs text-content-muted">
          {requestIdLabel ? `${requestIdLabel}: ` : null}
          <span className="font-mono">{requestId}</span>
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
