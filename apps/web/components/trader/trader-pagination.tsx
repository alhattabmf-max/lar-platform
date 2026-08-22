import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonClasses } from "@/components/ui/button";

/**
 * Paging through a trader list.
 *
 * Anchors, not buttons: these move between URLs, so they work without
 * JavaScript, open in a new tab on middle-click, and are announced as
 * links rather than as buttons that mysteriously change the address
 * bar.
 *
 * An unavailable direction renders as a `<span>` rather than a
 * disabled link, because there is no such thing as a disabled anchor —
 * an `<a>` with `aria-disabled` is still focusable and still activates.
 *
 * `basePath` is a fixed internal path chosen by the caller, never a
 * value taken from a query string or a response: an href builder that
 * accepts a caller-supplied destination is an open redirect waiting
 * for its first untrusted input.
 */
export interface TraderPaginationProps {
  /** Locale-prefixed internal path, e.g. `/ar-SA/trader/orders`. */
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  labels: {
    navLabel: string;
    previous: string;
    next: string;
    /** Already interpolated, e.g. "Page 2 of 7". */
    status: string;
  };
  className?: string;
}

export function TraderPagination({
  basePath,
  page,
  pageSize,
  total,
  labels,
  className,
}: TraderPaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  // One page of results needs no pager at all.
  if (lastPage <= 1) return null;

  // `page=1` is omitted, so the canonical first-page URL is bare.
  const href = (target: number) => (target <= 1 ? basePath : `${basePath}?page=${target}`);

  return (
    <nav
      aria-label={labels.navLabel}
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonClasses("ghost", "sm")}>
          {labels.previous}
        </Link>
      ) : (
        <span className="text-sm text-content-muted">{labels.previous}</span>
      )}

      <span className="text-sm text-content-muted">{labels.status}</span>

      {page < lastPage ? (
        <Link href={href(page + 1)} className={buttonClasses("ghost", "sm")}>
          {labels.next}
        </Link>
      ) : (
        <span className="text-sm text-content-muted">{labels.next}</span>
      )}
    </nav>
  );
}

/** Reads a `?page=` value, clamped to something sane. */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
