import type {
  CityItem,
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

export function loadCities(): Promise<Loaded<CityItem[]>> {
  return load(() => apiClient.get<CityItem[]>("/cities/active", { revalidate: REFERENCE_DATA_TTL }));
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

export async function loadOpportunityDetail(id: string): Promise<OpportunityDetailResult> {
  try {
    const data = await apiClient.get<PublicOpportunityDetail>(`/opportunities/${id}`, {
      revalidate: OPPORTUNITY_LIST_TTL,
    });
    return { ok: true, data };
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return { ok: false, notFound: true };
    }
    return { ok: false, notFound: false, error: toUserFacingError(error) };
  }
}
