import { cn } from "@/lib/cn";

/**
 * Skip link — the first focusable element on every page.
 *
 * Visually hidden until focused, then pinned to the start of the block
 * axis. `inset-inline-start` (not `left`) keeps it on the correct side
 * in both RTL and LTR without a second rule.
 */
export interface SkipLinkProps {
  /** Translated, e.g. "Skip to main content". */
  label: string;
  targetId?: string;
  className?: string;
}

export function SkipLink({ label, targetId = "main-content", className }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        "sr-only focus:not-sr-only",
        "focus:absolute focus:z-50 focus:inset-block-start-2 focus:inset-inline-start-2",
        "focus:rounded-md focus:bg-primary focus:px-4 focus:py-2",
        "focus:text-sm focus:font-medium focus:text-primary-foreground",
        className
      )}
    >
      {label}
    </a>
  );
}
