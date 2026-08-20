"use client";

import { cn } from "@/lib/cn";
import { Button } from "./button";

/**
 * Pagination.
 *
 * Wrapped in <nav> with a translated accessible name, and the current
 * page is announced via `aria-current="page"`. All labels are passed in
 * already translated — this component holds no copy.
 */
export interface PaginationLabels {
  /** Accessible name for the <nav>, e.g. "Pagination". */
  navLabel: string;
  previous: string;
  next: string;
  /** Already-interpolated, e.g. "Page 2 of 7". */
  status: string;
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  labels: PaginationLabels;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  labels,
  onPageChange,
  className,
}: PaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const canGoBack = page > 1;
  const canGoForward = page < lastPage;

  return (
    <nav
      aria-label={labels.navLabel}
      className={cn("flex items-center justify-between gap-3", className)}
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={!canGoBack}
        onClick={() => onPageChange(page - 1)}
      >
        {labels.previous}
      </Button>

      <span aria-current="page" className="text-sm text-content-muted">
        {labels.status}
      </span>

      <Button
        variant="ghost"
        size="sm"
        disabled={!canGoForward}
        onClick={() => onPageChange(page + 1)}
      >
        {labels.next}
      </Button>
    </nav>
  );
}
