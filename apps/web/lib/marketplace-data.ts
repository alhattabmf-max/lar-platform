import type {
  CityItem,
  RegionItem,
  Paginated,
  PublicOpportunityDetail,
  PublicOpportunityItem,
  PublicPolicyVersion,
  SalesUnitItem,
  TaxonomyNodeItem,
} from "@platform/types";
import { apiClient } from "./api-client";
import { isApiError } from "./errors";
import { toUserFacingError, type UserFacingError } from "./error-messages";
import { toApiQueryString, type MarketplaceQuery } from "./marketplace-query";

/**
 * Server-side reads for the public marketplace.
 *
 * Everything here is anonymous and cacheable, so each read opts in to a
 * revalidate window explicitly — the api-client defaults to `no-store`
 * precisely so that a sensitive read can never be cached by omission.
 * Reference data (cities, categories, policies) changes rarely and gets
 * a long window; the opportunity list changes as windows open and close
 * and gets a short one.
 *
 * Results are returned as a discriminated union rather than thrown,
 * because a page needs to render a real error state with the request id
 * for support, not an unhandled exception.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: UserFacingError };

const REFERENCE_DATA_TTL = 300;
const OPPORTUNITY_LIST_TTL = 30;

async function load<T>(fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: toUserFacingError(error) };
  }
}

/**
 * The regions a branch form and the marketplace filter offer.
 *
 * THE PLATFORM'S OPERATIONAL UNIT, so this is the list that matters —
 * `loadCities` below is the optional refinement beneath it.
 */
export function loadRegions(): Promise<Loaded<RegionItem[]>> {
  return load(() =>
    apiClient.get<RegionItem[]>("/regions/active", { revalidate: REFERENCE_DATA_TTL })
  );
}

/**
 * The active cities — of ONE REGION when a region is named.
 *
 * THE WHOLE LIST WAS THE DEFAULT and it should not have been. A city
 * picker shows the cities of the region beside it and nothing else, so
 * the marketplace filter received every active city and narrowed them
 * in the browser. They were serialised twice into every page — as
 * markup and again into the RSC payload — to display at most one
 * region's worth.
 */
export function loadCities(regionId?: string): Promise<Loaded<CityItem[]>> {
  return load(() =>
    apiClient.get<CityItem[]>(
      `/cities/active${regionId ? `?regionId=${encodeURIComponent(regionId)}` : ""}`,
      { revalidate: REFERENCE_DATA_TTL }
    )
  );
}

export function loadTaxonomy(): Promise<Loaded<TaxonomyNodeItem[]>> {
  return load(() =>
    apiClient.get<TaxonomyNodeItem[]>("/taxonomy/active", { revalidate: REFERENCE_DATA_TTL })
  );
}

/**
 * The admin-managed selling units, for the supplier's product form.
 *
 * Anonymous, cacheable reference data exactly like cities and categories,
 * so it lives here rather than in `supplier-data.ts` — that module's whole
 * guarantee is that every read in it is `no-store` and carries a session
 * cookie, and this read is neither.
 */
export function loadSalesUnits(): Promise<Loaded<SalesUnitItem[]>> {
  return load(() =>
    apiClient.get<SalesUnitItem[]>("/sales-units/active", { revalidate: REFERENCE_DATA_TTL })
  );
}

export function loadPolicies(): Promise<Loaded<PublicPolicyVersion[]>> {
  return load(() =>
    apiClient.get<PublicPolicyVersion[]>("/policies/active", { revalidate: REFERENCE_DATA_TTL })
  );
}

export function loadOpportunities(
  query: MarketplaceQuery
): Promise<Loaded<Paginated<PublicOpportunityItem>>> {
  return load(() =>
    apiClient.get<Paginated<PublicOpportunityItem>>(
      `/opportunities/active?${toApiQueryString(query)}`,
      { revalidate: OPPORTUNITY_LIST_TTL }
    )
  );
}

/**
 * A single opportunity, with "not found" separated from "failed".
 *
 * The API answers unknown, not-yet-visible and no-longer-visible ids
 * with the same 404 — deliberately, so probing ids reveals nothing — so
 * this collapses them into one `notFound` outcome and lets the page
 * render Next's 404 rather than an error state that would imply the
 * opportunity exists but is broken.
 */
export type OpportunityDetailResult =
  | { ok: true; data: PublicOpportunityDetail }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; error: UserFacingError };

/**
 * ONE OFFER, READ FRESH EVERY TIME — and it has to be.
 *
 * IT WAS CACHED FOR THIRTY SECONDS AND NEVER EXPIRED. Measured live: an
 * offer an operator had CANCELLED kept answering 200 with its name and
 * its price, on five consecutive requests and again thirty-five seconds
 * later, while the API answered 404 to every one of them. Clearing
 * `.next/cache/fetch-cache` was the only thing that stopped it.
 *
 * THE MECHANISM IS THE POINT, because it decides the fix. Next serves a
 * stale entry and revalidates behind the request; a revalidation that
 * comes back NON-2xx does not evict — it keeps the last good response.
 * So a read whose upstream can turn into a 404 has no expiry at all:
 * the very answer that should remove it is the one Next discards.
 *
 * AND THAT IS WHY "EVICT ON 404" CANNOT BE WRITTEN HERE. During render
 * there is no way to tell a cached hit from a fresh one — the only read
 * that could detect the staleness is an uncached read, which is this.
 * `revalidateTag` is a Server Action's tool and cannot run in a page.
 *
 * THE LIST IS NOT AFFECTED and keeps its window: its upstream stays
 * 200 and simply returns fewer rows, so it expires normally. Only a
 * read that can BECOME an error is exposed, and this is the one.
 */
export async function loadOpportunityDetail(id: string): Promise<OpportunityDetailResult> {
  try {
    const data = await apiClient.get<PublicOpportunityDetail>(`/opportunities/${id}`, {
      cache: "no-store",
    });
    return { ok: true, data };
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return { ok: false, notFound: true };
    }
    return { ok: false, notFound: false, error: toUserFacingError(error) };
  }
}
