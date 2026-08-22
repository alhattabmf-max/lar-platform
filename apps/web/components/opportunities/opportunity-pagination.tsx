import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonClasses } from "@/components/ui/button";
import {
  marketplaceHref,
  withPage,
  PUBLIC_OPPORTUNITIES_PATH,
  type MarketplaceQuery,
} from "@/lib/marketplace-query";

/**
 * Pagination as LINKS.
 *
 * The button-based `components/ui/pagination.tsx` drives in-place state
 * on an interactive list. This one moves between URLs, so it renders
 * anchors: they work without JavaScript, open in a new tab on
 * middle-click, and are announced as links rather than as buttons that
 * mysteriously change the address bar.
 *
 * An unavailable direction renders as a `<span>` rather than a disabled
 * link, because there is no such thing as a disabled anchor — an `<a>`
 * with `aria-disabled` is still focusable and still activates.
 */
export interface OpportunityPaginationLabels {
  navLabel: string;
  previous: string;
  next: string;
  /** Already interpolated, e.g. "Page 2 of 7". */
  status: string;
}

export interface OpportunityPaginationProps {
  locale: string;
  query: MarketplaceQuery;
  total: number;
  labels: OpportunityPaginationLabels;
  className?: string;
  /** Which listing these pages belong to. Defaults to the public one. */
  basePath?: string;
}

export function OpportunityPagination({
  locale,
  query,
  total,
  labels,
  className,
  basePath = PUBLIC_OPPORTUNITIES_PATH,
}: OpportunityPaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize));

  // One page of results needs no pager at all.
  if (lastPage <= 1) return null;

  const canGoBack = query.page > 1;
  const canGoForward = query.page < lastPage;
  const inactive = "inline-flex items-center rounded-md px-3 py-1.5 text-sm text-content-muted opacity-50";

  return (
    <nav aria-label={labels.navLabel} className={cn("flex items-center justify-between gap-3", className)}>
      {canGoBack ? (
        <Link
          href={marketplaceHref(locale, withPage(query, query.page - 1), basePath)}
          rel="prev"
          className={buttonClasses("ghost", "sm")}
        >
          {labels.previous}
        </Link>
      ) : (
        <span className={inactive}>{labels.previous}</span>
      )}

      <span aria-current="page" className="text-sm text-content-muted">
        {labels.status}
      </span>

      {canGoForward ? (
        <Link
          href={marketplaceHref(locale, withPage(query, query.page + 1), basePath)}
          rel="next"
          className={buttonClasses("ghost", "sm")}
        >
          {labels.next}
        </Link>
      ) : (
        <span className={inactive}>{labels.next}</span>
      )}
    </nav>
  );
}
