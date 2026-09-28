import { cookies } from "next/headers";
import type {
  CheckoutSessionView,
  DisputeSummary,
  DocumentSummary,
  NotificationItem,
  NotificationUnreadCount,
  OrderDetail,
  OrderSummary,
  Paginated,
  ReplacementDetail,
  ReplacementSummary,
  TraderDisputeDetailView,
  TraderOpportunityDetail,
  TraderOpportunityItem,
} from "@platform/types";
import { apiClient } from "./api-client";
import { toUserFacingError, type UserFacingError } from "./error-messages";
import { toApiQueryString, type MarketplaceQuery } from "./marketplace-query";

/**
 * Server-side reads for the trader portal.
 *
 * Every one is `cache: "no-store"`, which is not a default anyone may
 * forget: these are a signed-in person's own orders and notifications,
 * and a cached response served after logout — or to the next user on a
 * shared cache — is the failure this rules out.
 *
 * The session cookie is FORWARDED, never read or parsed. Server
 * Components have no cookie jar of their own, so the header is
 * assembled here and handed to the client.
 *
 * Results come back as a discriminated union rather than thrown, so a
 * panel that fails renders its own error state with a request id
 * instead of taking down the whole page.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: UserFacingError };

async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    const header = await cookieHeader();
    return {
      ok: true,
      data: await apiClient.get<T>(path, { cache: "no-store", cookieHeader: header }),
    };
  } catch (error) {
    return { ok: false, error: toUserFacingError(error) };
  }
}

/**
 * A read where "not found" is a distinct outcome from "failed".
 *
 * Every trader detail endpoint answers an unknown id and another
 * company's id with the same 404 — deliberately, so probing reveals
 * nothing. Collapsing both into `notFound` lets a page render a real
 * 404 rather than an error state implying the record exists but is
 * broken.
 */
export type Found<T> =
  | { ok: true; data: T }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; error: UserFacingError };

async function loadOrNotFound<T>(path: string): Promise<Found<T>> {
  const result = await load<T>(path);
  if (result.ok) return result;
  if (result.error.kind === "notFound") return { ok: false, notFound: true };
  return { ok: false, notFound: false, error: result.error };
}

/** Serialises the page controls every trader list shares. */
function pageQuery(query: { page?: number; pageSize?: number }): string {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const search = params.toString();
  return search ? `?${search}` : "";
}

export function loadTraderOrders(
  query: { page?: number; pageSize?: number } = {}
): Promise<Loaded<Paginated<OrderSummary>>> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const search = params.toString();

  return load<Paginated<OrderSummary>>(`/trader/orders${search ? `?${search}` : ""}`);
}

export function loadUnreadNotificationCount(): Promise<Loaded<NotificationUnreadCount>> {
  return load<NotificationUnreadCount>("/trader/notifications/unread-count");
}

/**
 * The trader's own branches.
 *
 * `/companies/me/locations` is scoped to the session's company by the
 * API, and returns only active locations.
 *
 * Typed to the fields this portal renders, not to the row the endpoint
 * happens to return. The response also carries the stored coordinates;
 * declaring them here would invite a screen that prints a latitude at
 * someone, which is not an address and helps nobody read their own
 * branch list.
 */
export interface TraderLocation {
  id: string;
  /** WHERE THE BRANCH IS. Never null: every branch has a region. */
  regionId: string;
  /** The optional refinement. Null when the branch names no city. */
  cityId: string | null;
  name: string;
  shortAddress: string;
  contactName: string;
  contactPhone: string;
  isDefault: boolean;
}

export function loadTraderLocations(): Promise<Loaded<TraderLocation[]>> {
  return load<TraderLocation[]>("/companies/me/locations");
}

/**
 * The trader's billing identity, used on every invoice issued to them.
 *
 * `/trader/settings/tax-profile` is the TRADER-scoped endpoint behind
 * `RequireTraderGuard`. The similarly-named `/companies/me/tax-profile`
 * reads `supplier_tax_profiles`, which for a trader is null forever.
 *
 * Null is a real answer, not an error: a trader who has not set a
 * billing profile yet simply does not have one.
 */
export interface TraderTaxProfile {
  isVatRegistered: boolean;
  vatNumber: string | null;
  billingLegalName: string;
}

export function loadTraderTaxProfile(): Promise<Loaded<TraderTaxProfile | null>> {
  return load<TraderTaxProfile | null>("/trader/settings/tax-profile");
}

/**
 * Re-exported so pages and components name one type.
 *
 * These are the SHARED contracts from `@platform/types`, composed
 * there from the public presentation fields plus the trader-only
 * terms. This file no longer declares a local mirror: the mirror is
 * how a field gets renamed on one side and not the other, and it was
 * exactly what let `unitPriceAmount: number` live here while the
 * contract said `unitPriceInclTaxAmount: string`.
 */
export type { TraderOpportunityItem, TraderOpportunityDetail } from "@platform/types";

export function loadTraderOpportunities(
  query: MarketplaceQuery
): Promise<Loaded<Paginated<TraderOpportunityItem>>> {
  return load<Paginated<TraderOpportunityItem>>(
    `/trader/opportunities/active?${toApiQueryString(query)}`
  );
}

/**
 * One opportunity, with "not found" kept separate from "failed".
 *
 * The API answers unknown, not-yet-visible and no-longer-visible ids
 * with the same 404 so that probing ids reveals nothing. Collapsing
 * them into one `notFound` lets the page render a real 404 instead of
 * an error state implying the opportunity exists but is broken.
 */
export type TraderOpportunityResult = Found<TraderOpportunityDetail>;

export function loadTraderOpportunity(id: string): Promise<TraderOpportunityResult> {
  return loadOrNotFound<TraderOpportunityDetail>(`/trader/opportunities/${id}`);
}

/**
 * One checkout session, with "not found" kept separate from "failed".
 *
 * The API scopes the lookup to the caller's company inside the query,
 * so another company's session and a nonexistent one produce the same
 * 404. Collapsing them here preserves that: the page renders one Next
 * 404 either way and confirms nothing by being probed.
 */
export type CheckoutSessionResult = Found<CheckoutSessionView>;

export function loadCheckoutSession(id: string): Promise<CheckoutSessionResult> {
  return loadOrNotFound<CheckoutSessionView>(`/trader/checkout-sessions/${id}`);
}

// ---------------------------------------------------------------- orders

export function loadTraderOrder(id: string): Promise<Found<OrderDetail>> {
  return loadOrNotFound<OrderDetail>(`/trader/orders/${id}`);
}

/**
 * The internal documents for ONE order, from that order's own endpoint.
 *
 * There is no flat, paginated documents endpoint, so there is no
 * standalone documents page: building one would mean fanning out over
 * the orders list, which is an N+1 whose page boundaries would be the
 * ORDERS' — a reader would see rows skip and repeat as they paged. The
 * documents belong to an order and are read with it.
 */
export function loadOrderDocuments(orderId: string): Promise<Loaded<DocumentSummary[]>> {
  return load<DocumentSummary[]>(`/trader/orders/${orderId}/documents`);
}

// ---------------------------------------------------------------- notifications

export function loadNotifications(
  query: { page?: number; pageSize?: number; unreadOnly?: boolean } = {}
): Promise<Loaded<Paginated<NotificationItem>>> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.unreadOnly) params.set("unreadOnly", "true");
  const search = params.toString();

  return load<Paginated<NotificationItem>>(`/trader/notifications${search ? `?${search}` : ""}`);
}

// ---------------------------------------------------------------- disputes

export function loadDisputes(
  query: { page?: number; pageSize?: number } = {}
): Promise<Loaded<Paginated<DisputeSummary>>> {
  return load<Paginated<DisputeSummary>>(`/trader/disputes${pageQuery(query)}`);
}

/**
 * Re-exported so pages name the SHARED contract.
 *
 * The endpoint returns exactly this now: no storage key, no uploader,
 * no administrator's note, and only the trader company's own evidence
 * — filtered in SQL rather than fetched and discarded. A local mirror
 * here would be free to drift from it.
 */
export type { TraderDisputeDetailView } from "@platform/types";

export function loadDispute(id: string): Promise<Found<TraderDisputeDetailView>> {
  return loadOrNotFound<TraderDisputeDetailView>(`/trader/disputes/${id}`);
}

// ---------------------------------------------------------------- replacements

export function loadReplacements(
  query: { page?: number; pageSize?: number } = {}
): Promise<Loaded<Paginated<ReplacementSummary>>> {
  return load<Paginated<ReplacementSummary>>(`/trader/replacement-obligations${pageQuery(query)}`);
}

export function loadReplacement(id: string): Promise<Found<ReplacementDetail>> {
  return loadOrNotFound<ReplacementDetail>(`/trader/replacement-obligations/${id}`);
}

// ---------------------------------------------------------------- product reports

/**
 * The trader's own product reports.
 *
 * Not paginated by the API — it returns the company's own list — so
 * this does not invent a pager. A page control over an unpaginated
 * endpoint is a lie about what the next page contains.
 */
export interface TraderProductReport {
  id: string;
  productId: string;
  reasonCode: string;
  status: string;
  createdAt: string;
}

export function loadMyProductReports(): Promise<Loaded<TraderProductReport[]>> {
  return load<TraderProductReport[]>("/trader/product-reports/mine");
}
