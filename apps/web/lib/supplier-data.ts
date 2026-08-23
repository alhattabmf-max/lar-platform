import { cookies } from "next/headers";
import type {
  DocumentSummary,
  NotificationItem,
  NotificationUnreadCount,
  Paginated,
  SettlementDetail,
  SupplierAllocationDetail,
  SupplierDisputeDetailView,
  SupplierOrderDetail,
  SupplierReplacementDetail,
  ProductDetail,
  ProductSummary,
  SettlementSummary,
  SupplierDisputeSummary,
  SupplierOpportunityDetail,
  SupplierOpportunitySummary,
  SupplierOrderSummary,
  SupplierReplacementSummary,
} from "@platform/types";
import { apiClient } from "./api-client";
import { toUserFacingError, type UserFacingError } from "./error-messages";

/**
 * Server-side reads for the supplier portal.
 *
 * Every one is `cache: "no-store"`, which is not a default anyone may
 * forget: these are a signed-in company's own orders, payouts and bank
 * details, and a cached response served after logout — or to the next
 * user on a shared cache — is the failure this rules out.
 *
 * The session cookie is FORWARDED, never read or parsed. Server
 * Components have no cookie jar of their own, so the header is
 * assembled here and handed to the client.
 *
 * Results come back as a discriminated union rather than thrown, so a
 * panel that fails renders its own error state with a request id
 * instead of taking down the whole page.
 *
 * The `load` helper below is a deliberate twin of the one in
 * `trader-data.ts` rather than a shared import. Each portal's data
 * module proves its own no-store and cookie-forwarding guarantees at
 * the source level, and a shared helper would move those requests out
 * of the file the guarantee is asserted against — leaving both modules
 * passing a test that no longer looks at any request.
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
 * Every supplier detail endpoint answers an unknown id and another
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

/** Serialises the page controls every supplier list shares. */
function pageQuery(query: { page?: number; pageSize?: number }): string {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const search = params.toString();
  return search ? `?${search}` : "";
}

// ---------------------------------------------------------------- orders

/**
 * The supplier's own orders.
 *
 * `SupplierOrderSummary` is the CLOSED projection added in 8E.2 — it
 * carries no trader identity, and every amount is a fixed-scale
 * decimal string. The per-order aggregates (`awaitingPreparationCount`,
 * `hasOverduePreparation`) are computed server-side, so a dashboard
 * that needs them costs one request rather than one per order.
 */
export function loadSupplierOrders(
  query: { page?: number; pageSize?: number } = {}
): Promise<Loaded<Paginated<SupplierOrderSummary>>> {
  return load<Paginated<SupplierOrderSummary>>(`/supplier/orders${pageQuery(query)}`);
}

export function loadSupplierOrder(id: string): Promise<Found<SupplierOrderDetail>> {
  return loadOrNotFound<SupplierOrderDetail>(`/supplier/orders/${id}`);
}

/**
 * The internal documents for ONE order, from that order's own endpoint.
 *
 * There is no flat, paginated documents endpoint, so there is no standalone
 * documents page: building one would mean fanning out over the orders list,
 * an N+1 whose page boundaries would be the ORDERS' — a reader would see
 * rows skip and repeat as they paged. Documents belong to an order and are
 * read with it.
 *
 * The supplier DOES see `INTERNAL_COMMISSION_DRAFT`, unlike the trader: it
 * records what the platform charges them, and billing someone without
 * letting them see what for is not defensible. Every item carries
 * `notice: NOT_A_TAX_INVOICE`, and the contract has no field for a PDF, a
 * QR code or a ZATCA identifier.
 */
export function loadSupplierOrderDocuments(
  orderId: string
): Promise<Loaded<DocumentSummary[]>> {
  return load<DocumentSummary[]>(`/supplier/orders/${orderId}/documents`);
}

/** Re-exported so pages name the SHARED contract rather than a local mirror. */
export type { SupplierAllocationDetail, SupplierOrderDetail };

// ---------------------------------------------------------------- notifications

export function loadSupplierUnreadCount(): Promise<Loaded<NotificationUnreadCount>> {
  return load<NotificationUnreadCount>("/supplier/notifications/unread-count");
}

/**
 * The signed-in USER's notifications.
 *
 * `NotificationsService` filters on both `userId` and `companyId`, so read
 * state is per person: a colleague clearing their feed does not clear
 * anyone else's. That isolation is a property of the service, not of this
 * caller.
 */
export function loadSupplierNotifications(
  query: { page?: number; pageSize?: number; unreadOnly?: boolean } = {}
): Promise<Loaded<Paginated<NotificationItem>>> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.unreadOnly) params.set("unreadOnly", "true");
  const search = params.toString();

  return load<Paginated<NotificationItem>>(`/supplier/notifications${search ? `?${search}` : ""}`);
}

// ---------------------------------------------------------------- disputes

/**
 * Disputes raised AGAINST this supplier.
 *
 * `awaitingSupplierResponse` is derived server-side from the status, so
 * "does this need me?" is one field rather than a rule the UI has to
 * re-derive — and re-derive identically to the API.
 */
export function loadSupplierDisputes(
  query: { page?: number; pageSize?: number } = {}
): Promise<Loaded<Paginated<SupplierDisputeSummary>>> {
  return load<Paginated<SupplierDisputeSummary>>(`/supplier/disputes${pageQuery(query)}`);
}

/**
 * One dispute, as the closed `SupplierDisputeDetailView`.
 *
 * No storage key, no uploader, no administrator's `reasonNote`, and only
 * the supplier COMPANY's own evidence — filtered in SQL rather than fetched
 * and discarded. The trader's `description` IS here: it is the accusation
 * this supplier must answer, and withholding it would make responding
 * impossible.
 */
export function loadSupplierDispute(id: string): Promise<Found<SupplierDisputeDetailView>> {
  return loadOrNotFound<SupplierDisputeDetailView>(`/supplier/disputes/${id}`);
}

// ---------------------------------------------------------------- replacements

export function loadSupplierReplacements(
  query: { page?: number; pageSize?: number } = {}
): Promise<Loaded<Paginated<SupplierReplacementSummary>>> {
  return load<Paginated<SupplierReplacementSummary>>(
    `/supplier/replacement-obligations${pageQuery(query)}`
  );
}

export function loadSupplierReplacement(
  id: string
): Promise<Found<SupplierReplacementDetail>> {
  return loadOrNotFound<SupplierReplacementDetail>(`/supplier/replacement-obligations/${id}`);
}

// ---------------------------------------------------------------- settlements

/**
 * What the supplier has been paid.
 *
 * `netAmount` is a decimal string and is formatted at the edge of
 * rendering. Nothing here is summed: a total the client computes will
 * eventually disagree with the transfers that actually happened, and
 * the version a person believes is the one on their screen.
 */
export function loadSupplierSettlements(
  query: { page?: number; pageSize?: number } = {}
): Promise<Loaded<Paginated<SettlementSummary>>> {
  return load<Paginated<SettlementSummary>>(`/supplier/settlements${pageQuery(query)}`);
}

/**
 * One payout, with the FROZEN basis it was calculated from.
 *
 * `externalTransferReference`, `executedByAdminUserId` and
 * `supplierBankAccountId` are not on this contract and are not selected by
 * the query behind it — they describe the platform's banking operation, not
 * the supplier's money. There is no ledger posting and no journal entry
 * either.
 */
export function loadSupplierSettlement(id: string): Promise<Found<SettlementDetail>> {
  return loadOrNotFound<SettlementDetail>(`/supplier/settlements/${id}`);
}

// --------------------------------------------------------------- products

/**
 * The supplier's catalogue.
 *
 * NOT paginated by the API — it returns the company's own list — so
 * this does not invent a pager. A page control over an unpaginated
 * endpoint is a lie about what the next page contains.
 *
 * `ProductSummary` carries `thumbnailUrl` as a relative API path built
 * from ids. It is an address, not a capability: the delivery route
 * re-checks ownership against the current session on every request, so
 * possessing the string grants nothing. No storage key crosses the
 * wire, and nothing here is presigned.
 */
export function loadSupplierProducts(): Promise<Loaded<ProductSummary[]>> {
  return load<ProductSummary[]>("/companies/me/products");
}

export function loadSupplierProduct(id: string): Promise<Found<ProductDetail>> {
  return loadOrNotFound<ProductDetail>(`/companies/me/products/${id}`);
}

// ---------------------------------------------------------- opportunities

/**
 * The supplier's own listings.
 *
 * NOT paginated by the API — it returns the company's own list — so this
 * does not invent a pager.
 *
 * Every amount on these contracts is a fixed-scale decimal string. It was
 * a JSON number until 8E.4, which is why no opportunity screen existed:
 * `formatMoney` takes a decimal string and `isMoneyString` rejects a number
 * at runtime, so there was no honest way to render a price.
 */
export function loadSupplierOpportunities(): Promise<Loaded<SupplierOpportunitySummary[]>> {
  return load<SupplierOpportunitySummary[]>("/companies/me/opportunities");
}

export function loadSupplierOpportunity(
  id: string
): Promise<Found<SupplierOpportunityDetail>> {
  return loadOrNotFound<SupplierOpportunityDetail>(`/companies/me/opportunities/${id}`);
}

// ---------------------------------------------------------------- account

/**
 * Whether this company can actually be paid.
 *
 * Three preconditions, each a separate boolean rather than one opaque
 * flag, so the portal can name the missing one instead of telling
 * someone they are "not ready" and leaving them to guess which part.
 */
export interface SupplierFinancialReadiness {
  isReady: boolean;
  hasVerifiedBankAccount: boolean;
  hasTaxProfile: boolean;
  hasInvoicingProfile: boolean;
}

export function loadFinancialReadiness(): Promise<Loaded<SupplierFinancialReadiness>> {
  return load<SupplierFinancialReadiness>("/companies/me/financial-readiness");
}

/**
 * The supplier's payout accounts.
 *
 * Typed to `ibanLast4` because that is all the API sends: the stored
 * IBAN is encrypted and its ciphertext and fingerprint are never in a
 * supplier-facing response. Declaring an `iban` field here would be a
 * claim the endpoint does not honour, and the kind of claim someone
 * later "fixes" by making the endpoint honour it.
 */
export interface SupplierBankAccount {
  id: string;
  accountHolderName: string;
  bankName: string;
  ibanLast4: string;
  verificationStatus: string;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export function loadSupplierBankAccounts(): Promise<Loaded<SupplierBankAccount[]>> {
  return load<SupplierBankAccount[]>("/companies/me/bank-account");
}

/**
 * VAT registration, or null.
 *
 * Null is a real answer, not an error: a supplier who has not recorded
 * a tax profile yet simply does not have one, and the page says which
 * of the two it is.
 */
export interface SupplierTaxProfile {
  isVatRegistered: boolean;
  vatNumber: string | null;
}

export function loadSupplierTaxProfile(): Promise<Loaded<SupplierTaxProfile | null>> {
  return load<SupplierTaxProfile | null>("/companies/me/tax-profile");
}

/** The legal name the platform's own commission documents are issued to. */
export interface SupplierInvoicingProfile {
  invoicingLegalName: string;
}

export function loadSupplierInvoicingProfile(): Promise<Loaded<SupplierInvoicingProfile | null>> {
  return load<SupplierInvoicingProfile | null>("/companies/me/invoicing-profile");
}

/**
 * The company's registered locations.
 *
 * Typed to the fields this portal renders, not to the row the endpoint
 * returns. The response also carries stored coordinates; declaring
 * them here would invite a screen that prints a latitude at someone,
 * which is not an address and helps nobody read their own site list.
 */
export interface SupplierLocation {
  id: string;
  cityId: string;
  name: string;
  shortAddress: string;
  contactName: string;
  contactPhone: string;
  isDefault: boolean;
}

export function loadSupplierLocations(): Promise<Loaded<SupplierLocation[]>> {
  return load<SupplierLocation[]>("/companies/me/locations");
}
