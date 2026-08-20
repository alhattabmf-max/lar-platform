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
      className={cn("animate-pulse rounded-md bg-line", className)}
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
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-line",
        "bg-surface px-6 py-10 text-center",
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
