
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

