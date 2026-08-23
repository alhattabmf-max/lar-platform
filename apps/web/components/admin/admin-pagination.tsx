import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonClasses } from "@/components/ui/button";

/**
 * Paging through an admin list, without losing the filters.
 *
 * The trader's pager builds `?page=N` and nothing else, which is
 * correct there because those lists have no filters. Here it would
 * silently discard the operator's search and status filter on every
 * page change — the reader would page from a filtered page 1 into an
 * unfiltered page 2 and see different rows than they asked for. So the
 * current query is carried forward and only `page` is replaced.
 *
 * Anchors, not buttons: these move between URLs, so they work without
 * JavaScript, open in a new tab on middle-click, and are announced as
 * links rather than as buttons that mysteriously change the address bar.
 *
 * An unavailable direction renders as a `<span>`, because there is no
 * such thing as a disabled anchor — an `<a>` with `aria-disabled` is
 * still focusable and still activates.
 *
 * `basePath` is a fixed internal path chosen by the caller, never a
 * value taken from a query string or a response: an href builder that
 * accepts a caller-supplied destination is an open redirect waiting for
 * its first untrusted input.
 */
export interface AdminPaginationProps {
  /** Locale-prefixed internal path, e.g. `/ar-SA/admin/companies`. */
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  /** The current filters, carried into every page link. */
  query?: Record<string, string | undefined>;
  labels: {
    navLabel: string;
    previous: string;
    next: string;
    /** Already interpolated, e.g. "Page 2 of 7". */
    status: string;
  };
  className?: string;
}

export function AdminPagination({
  basePath,
  page,
  pageSize,
  total,
  query = {},
  labels,
  className,
}: AdminPaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  // One page of results needs no pager at all.
  if (lastPage <= 1) return null;

  function href(target: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      // `page` is owned by this component; anything else the caller
      // passed is a filter and travels along.
      if (key === "page" || value === undefined || value === "") continue;
      params.set(key, value);
    }
    // Page 1 is left implicit, so the canonical first-page URL of an
    // unfiltered list is bare.
    if (target > 1) params.set("page", String(target));

    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

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
export function parseAdminPage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Reads one search-param value.
 *
 * Next gives `string | string[] | undefined`. A repeated parameter
 * (`?status=A&status=B`) arrives as an array, and taking the first is
 * the only reading that cannot produce `"A,B"` — a value no filter
 * accepts and which would silently return nothing.
 */
export function firstParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Builds the four pagination labels from the shared `pagination`
 * namespace.
 *
 * A helper rather than the same ten lines on twenty pages: the
 * "Page N of M" interpolation needs `lastPage`, which is derived from
 * the total and the page size, and deriving it separately on each page
 * is how one of them ends up off by one on an exact multiple.
 */
export function adminPaginationLabels(
  t: (key: string, values?: Record<string, string | number>) => string,
  page: number,
  pageSize: number,
  total: number
): AdminPaginationProps["labels"] {
  return {
    navLabel: t("navLabel"),
    previous: t("previous"),
    next: t("next"),
    status: t("status", { page, lastPage: Math.max(1, Math.ceil(total / pageSize)) }),
  };
}
