import {
  DEFAULT_PAGE_SIZE,
  OPPORTUNITY_SORTS,
  type OpportunitySort,
} from "@platform/types";

/**
 * The marketplace's URL state.
 *
 * Filters live in the query string, not in component state, so a
 * filtered view is linkable, bookmarkable, survives a reload, and works
 * with the back button. Everything is applied SERVER-SIDE by the API —
 * there is no client-side filtering of a page of results anywhere in
 * this app, because filtering a single page of a paginated list would
 * silently drop matches on every other page.
 */

export interface MarketplaceQuery {
  page: number;
  pageSize: number;
  cityId?: string;
  taxonomyNodeId?: string;
  sort: OpportunitySort;
}

/**
 * The default this SURFACE chooses, which is not the API's default.
 *
 * A marketplace visitor cares which opportunities are about to close;
 * the API keeps NEWEST so that callers predating the parameter are
 * unaffected. This screen therefore always sends its sort explicitly
 * rather than relying on either default.
 */
export const MARKETPLACE_DEFAULT_SORT: OpportunitySort = "ENDING_SOON";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Takes the first value when a parameter is repeated, e.g. `?page=1&page=2`. */
function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseUuid(value: string | string[] | undefined): string | undefined {
  const raw = single(value);
  return raw && UUID_PATTERN.test(raw) ? raw : undefined;
}

function parsePage(value: string | string[] | undefined): number {
  const raw = single(value);
  if (raw === undefined) return 1;
  // Integer-only: "2.5" and "2abc" are rejected rather than truncated,
  // so a nonsense page never quietly becomes a real one.
  if (!/^\d+$/.test(raw)) return 1;
  const parsed = Number.parseInt(raw, 10);
  return parsed >= 1 ? parsed : 1;
}

function parseSort(value: string | string[] | undefined): OpportunitySort {
  const raw = single(value);
  return OPPORTUNITY_SORTS.includes(raw as OpportunitySort)
    ? (raw as OpportunitySort)
    : MARKETPLACE_DEFAULT_SORT;
}

/**
 * Reads a URL into a query the API will accept.
 *
 * Unrecognised values are DROPPED, not forwarded. The API answers an
 * invalid `sort` or a malformed id with a 400, which is correct for a
 * programmatic caller — but a hand-edited or truncated address bar
 * should show the marketplace, not an error page. Sanitising here keeps
 * both behaviours: the API stays strict, and a person cannot break the
 * page by mistyping a URL.
 */
export function parseMarketplaceQuery(params: RawSearchParams): MarketplaceQuery {
  return {
    page: parsePage(params.page),
    pageSize: DEFAULT_PAGE_SIZE,
    cityId: parseUuid(params.cityId),
    taxonomyNodeId: parseUuid(params.taxonomyNodeId),
    sort: parseSort(params.sort),
  };
}

/** Serialises a query for the API request path. */
export function toApiQueryString(query: MarketplaceQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  params.set("sort", query.sort);
  if (query.cityId) params.set("cityId", query.cityId);
  if (query.taxonomyNodeId) params.set("taxonomyNodeId", query.taxonomyNodeId);
  return params.toString();
}

/**
 * Serialises a query for the address bar.
 *
 * `page=1` and the surface's default sort are omitted so the canonical
 * unfiltered URL is a bare `/opportunities` rather than one carrying
 * redundant parameters. `pageSize` is never written to the URL: it is
 * fixed for this surface, and exposing it would invite a hand-edited
 * value the API would then clamp, showing something other than what the
 * URL says.
 */
export function toUrlSearchParams(query: MarketplaceQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.cityId) params.set("cityId", query.cityId);
  if (query.taxonomyNodeId) params.set("taxonomyNodeId", query.taxonomyNodeId);
  if (query.sort !== MARKETPLACE_DEFAULT_SORT) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

/**
 * The anonymous marketplace listing. The default base path.
 *
 * The signed-in trader listing at `/{locale}/trader/opportunities` is
 * the SAME list with commercial terms added, and it parses, filters,
 * sorts and paginates identically — so both share this builder rather
 * than growing a second query vocabulary that can drift.
 */
export const PUBLIC_OPPORTUNITIES_PATH = "opportunities";

/**
 * Builds a listing href for the given locale and query.
 *
 * `basePath` is a fixed internal path chosen by the caller, never a
 * value taken from a query string or a response — an href builder that
 * accepts a caller-supplied destination is an open redirect waiting
 * for its first untrusted input.
 */
export function marketplaceHref(
  locale: string,
  query: MarketplaceQuery,
  basePath: string = PUBLIC_OPPORTUNITIES_PATH
): string {
  const search = toUrlSearchParams(query).toString();
  return `/${locale}/${basePath}${search ? `?${search}` : ""}`;
}

/**
 * Applies a filter change.
 *
 * Any change to a FILTER resets to page 1 — staying on page 4 while
 * narrowing the results is how a user lands on an empty page and
 * concludes there are no matches. A page change alone does not reset.
 */
export function withFilters(
  query: MarketplaceQuery,
  changes: Partial<Pick<MarketplaceQuery, "cityId" | "taxonomyNodeId" | "sort">>
): MarketplaceQuery {
  return { ...query, ...changes, page: 1 };
}

export function withPage(query: MarketplaceQuery, page: number): MarketplaceQuery {
  return { ...query, page: Math.max(1, page) };
}

/** True when any narrowing filter is active — drives the "clear filters" affordance. */
export function hasActiveFilters(query: MarketplaceQuery): boolean {
  return Boolean(query.cityId || query.taxonomyNodeId);
}
