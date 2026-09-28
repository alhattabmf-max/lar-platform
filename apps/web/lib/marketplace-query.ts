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
  /**
   * THE PRIMARY PLACE FILTER. A listing ships from a branch and a
   * branch is recorded against a region.
   */
  regionId?: string;
  /**
   * THE OPTIONAL REFINEMENT beneath it. Kept so a link bookmarked
   * before the region became the filter still works, and so a buyer
   * who wants one city inside a region can still say so.
   */
  cityId?: string;
  taxonomyNodeId?: string;
  /**
   * FREE TEXT FROM THE ONE SEARCH FIELD in the row of tabs.
   *
   * «كلٌّ يبحث في عالمه» and «الاسم والوصف معًا» — the API matches it
   * against the product's frozen name and description and the offer's
   * own, with ILIKE, so this is passed through untouched apart from
   * trimming.
   *
   * IN THE URL LIKE EVERY OTHER FILTER, so a search is linkable, comes
   * back on reload, and works with the back button. This app filters
   * nothing on the client: filtering one page of a paginated list would
   * silently drop matches on every other page.
   */
  q?: string;
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

/**
 * The typed term, or nothing.
 *
 * TRIMMED, AND EMPTY IS ABSENT — a form submitted with a blank box asks
 * for the unfiltered list, not for the offers whose name contains
 * nothing.
 *
 * CUT AT THE LENGTH THE API ACCEPTS rather than dropped past it. A
 * hand-edited address with two hundred characters in it should show the
 * marketplace, exactly as a mistyped sort does — and the API answers
 * 400 above a hundred.
 */
function parseTerm(value: string | string[] | undefined): string | undefined {
  const raw = single(value)?.trim();
  return raw ? raw.slice(0, 100) : undefined;
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
    regionId: parseUuid(params.regionId),
    cityId: parseUuid(params.cityId),
    taxonomyNodeId: parseUuid(params.taxonomyNodeId),
    q: parseTerm(params.q),
    sort: parseSort(params.sort),
  };
}

/** Serialises a query for the API request path. */
export function toApiQueryString(query: MarketplaceQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  params.set("sort", query.sort);
  if (query.regionId) params.set("regionId", query.regionId);
  if (query.cityId) params.set("cityId", query.cityId);
  if (query.taxonomyNodeId) params.set("taxonomyNodeId", query.taxonomyNodeId);
  if (query.q) params.set("q", query.q);
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
  if (query.regionId) params.set("regionId", query.regionId);
  if (query.cityId) params.set("cityId", query.cityId);
  if (query.taxonomyNodeId) params.set("taxonomyNodeId", query.taxonomyNodeId);
  if (query.q) params.set("q", query.q);
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
  changes: Partial<
    Pick<MarketplaceQuery, "regionId" | "cityId" | "taxonomyNodeId" | "sort">
  >
): MarketplaceQuery {
  const next = { ...query, ...changes, page: 1 };
  // CHANGING THE REGION CLEARS THE CITY, unless the caller set both in
  // the same change. A city belongs to exactly one region, so carrying
  // it across a region change would leave a filter pair that matches
  // nothing — and the visitor would read the empty page as "there is
  // nothing in this region".
  if (changes.regionId !== undefined && changes.cityId === undefined) {
    next.cityId = undefined;
  }
  return next;
}

export function withPage(query: MarketplaceQuery, page: number): MarketplaceQuery {
  return { ...query, page: Math.max(1, page) };
}

/**
 * True when any narrowing filter is active — drives the "clear filters"
 * affordance and the emptier of the two empty states.
 *
 * A SEARCH TERM IS A FILTER. It was left out at first and that made an
 * empty search read "there are no offers on this platform" instead of
 * "nothing matched what you typed" — the difference between a broken
 * platform and a word to change.
 */
export function hasActiveFilters(query: MarketplaceQuery): boolean {
  return Boolean(query.regionId || query.cityId || query.taxonomyNodeId || query.q);
}
