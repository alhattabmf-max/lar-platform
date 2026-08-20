/**
 * Wire contract for every paginated list response.
 *
 * Declared once here and used as the API's controller return type, so a
 * shape change breaks `typecheck` on both the API and the web app rather
 * than silently drifting. See docs/PHASE_8_IMPLEMENTATION_PLAN.md §4.
 */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Query shape every paginated endpoint accepts. */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

/**
 * Hard ceiling on `pageSize` for every paginated endpoint. A caller
 * asking for more is clamped, never served a larger page.
 */
export const MAX_PAGE_SIZE = 100;

export const DEFAULT_PAGE_SIZE = 20;
