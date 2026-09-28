"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { PAGE_SIZES } from "@/lib/admin-list-query";

/**
 * Paging a control panel list, without losing what it is filtered to.
 *
 * ONLY `page` AND `pageSize` ARE TOUCHED. Everything else in the query
 * string is a filter and travels along — a reader who pages from a
 * filtered page 1 into an unfiltered page 2 sees different rows than
 * they asked for and has no way to tell why.
 *
 * WINDOWED, NOT EXHAUSTIVE. A hundred-page list rendered as a hundred
 * buttons is not navigation. The first page, the last page, and the
 * neighbours of the current one are what a reader actually uses; the
 * gaps are ellipses rather than links, because an ellipsis that is
 * clickable is a button whose destination nobody can predict.
 *
 * THE ENDS ARE DISABLED BUTTONS, NOT ANCHORS. There is no such thing as
 * a disabled link: an `<a>` with `aria-disabled` is still focusable and
 * still activates. On the first page "previous" must be inert.
 */

export interface DataTablePaginationLabels {
  navLabel: string;
  first: string;
  previous: string;
  next: string;
  last: string;
  rowsPerPage: string;
  rowsPerPageUnit: string;
  /** Already interpolated, e.g. "Showing 1–25 of 120 organizations". */
  range: string;
}

export function DataTablePagination({
  page,
  pageSize,
  sizes,
  total,
  labels,
  className,
}: {
  page: number;
  pageSize: number;
  /**
   * The sizes this particular list offers.
   *
   * Defaults to the platform's three. The audit log passes its own,
   * because an entry is read one at a time and twenty-five of them is a
   * wall rather than a page.
   */
  sizes?: readonly number[];
  total: number;
  labels: DataTablePaginationLabels;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /**
   * "Page 3" IS FORMATTED HERE, for the same reason the filter count is:
   * a server page does not know which numbers the window will draw, and
   * resolving a message with an unfilled `{page}` returns the message
   * PATH — so every numbered button announced itself to a screen reader
   * as `pagination.pageNumber`.
   */
  const label = useTranslations("pagination");

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function go(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function toPage(target: number) {
    go((next) => {
      // Page 1 stays implicit, so the canonical first-page URL is bare.
      if (target <= 1) next.delete("page");
      else next.set("page", String(target));
    });
  }

  const control =
    "inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control border border-line " +
    "text-content hover:bg-background focus-visible:outline focus-visible:outline-2 " +
    "focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <nav
      aria-label={labels.navLabel}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
      data-testid="data-table-pagination"
    >
      <div className="flex items-center gap-2">
        <Label htmlFor="rows-per-page" className="whitespace-nowrap">
          {labels.rowsPerPage}
        </Label>
        <Select
          id="rows-per-page"
          value={String(pageSize)}
          data-testid="rows-per-page"
          className="w-24"
          onChange={(event) =>
            go((next) => {
              next.set("pageSize", event.target.value);
              // A larger page makes the current page number meaningless,
              // so the reader returns to the start of the same results.
              next.delete("page");
            })
          }
        >
          {(sizes ?? PAGE_SIZES).map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
        <span className="whitespace-nowrap text-sm text-content-muted">
          {labels.rowsPerPageUnit}
        </span>
      </div>

      <p className="text-sm text-content-muted" data-testid="pagination-range">
        {labels.range}
      </p>

      {/* NUMBERS ASCEND LEFT TO RIGHT IN BOTH LANGUAGES. A page
          sequence is a number line, not prose: laid out by the
          document's direction it renders 5 4 3 2 1 on an Arabic page,
          which reads as counting down. The labels around it are still
          translated; only the ORDER of the numbers is pinned. */}
      <div dir="ltr" className="flex items-center gap-1">
        <button
          type="button"
          className={control}
          disabled={page <= 1}
          aria-label={labels.first}
          data-testid="pagination-first"
          onClick={() => toPage(1)}
        >
          <ChevronsLeft aria-hidden="true" className="size-4" />
        </button>

        <button
          type="button"
          className={control}
          disabled={page <= 1}
          aria-label={labels.previous}
          data-testid="pagination-previous"
          onClick={() => toPage(page - 1)}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>

        {windowOf(page, lastPage).map((entry, index) =>
          entry === "gap" ? (
            <span
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 text-sm text-content-muted"
            >
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              aria-current={entry === page ? "page" : undefined}
              aria-label={label("pageNumber", { page: entry })}
              data-testid={`pagination-page-${entry}`}
              onClick={() => toPage(entry)}
              className={cn(
                control,
                entry === page &&
                  "border-primary bg-primary text-primary-foreground",
              )}
            >
              {entry}
            </button>
          ),
        )}

        <button
          type="button"
          className={control}
          disabled={page >= lastPage}
          aria-label={labels.next}
          data-testid="pagination-next"
          onClick={() => toPage(page + 1)}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>

        <button
          type="button"
          className={control}
          disabled={page >= lastPage}
          aria-label={labels.last}
          data-testid="pagination-last"
          onClick={() => toPage(lastPage)}
        >
          <ChevronsRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </nav>
  );
}

/**
 * Which page numbers to draw.
 *
 * The first, the last, and one either side of the current — with an
 * ellipsis wherever that skips something. Seven or fewer pages are all
 * drawn, because a gap in a list that short hides nothing worth hiding.
 */
export function windowOf(page: number, lastPage: number): (number | "gap")[] {
  if (lastPage <= 7)
    return Array.from({ length: lastPage }, (_, index) => index + 1);

  const wanted = new Set<number>([1, lastPage, page - 1, page, page + 1]);
  const pages = [...wanted]
    .filter((n) => n >= 1 && n <= lastPage)
    .sort((a, b) => a - b);

  const out: (number | "gap")[] = [];
  let previous = 0;
  for (const value of pages) {
    if (previous && value - previous > 1) out.push("gap");
    out.push(value);
    previous = value;
  }
  return out;
}
