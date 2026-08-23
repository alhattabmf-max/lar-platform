import { cookies } from "next/headers";
import type {
  AdminBankAccountItem,
  AdminBrandingView,
  BrandThemeAdminView,
  AdminCityItem,
  AdminCompanyItem,
  AdminDisputeDetail,
  AdminDisputeItem,
  AdminInvoiceDocumentItem,
  AdminOrderDetail,
  AdminOrderItem,
  AdminPendingProductItem,
  AdminPendingSupplierItem,
  AdminPlatformBillingProfile,
  AdminProductItem,
  AdminRefundDetail,
  AdminRefundItem,
  AdminRegionItem,
  AdminSalesUnitItem,
  AdminSettlementItem,
  AdminTaxonomyNodeItem,
  AdminUserItem,
  AuditLogEntry,
  OutboxStats,
  Paginated,
  SiteContent,
} from "@platform/types";
import { apiClient } from "./api-client";
import { toUserFacingError, type UserFacingError } from "./error-messages";

/**
 * Server-side reads for the admin portal.
 *
 * Every one is `cache: "no-store"`. These are the platform's operational
 * records — every company, every payout, every audit entry — and a
 * cached response served after logout, or to the next operator on a
 * shared cache, is the failure this rules out.
 *
 * The `asid` cookie is FORWARDED, never read or parsed. Server
 * Components have no cookie jar of their own, so the header is assembled
 * here and handed to the client.
 *
 * A deliberate twin of `supplier-data.ts` rather than a shared helper:
 * each portal's data module proves its own no-store and cookie-
 * forwarding guarantees at the source level, and a shared `load()` would
 * move the requests out of the file the guarantee is asserted against.
 *
 * Every function returns `Loaded<T>` rather than throwing. A page that
 * shows six panels must be able to render five when one read fails —
 * an operator whose dashboard goes blank because the outbox is
 * unreachable has lost the screen they would use to find out why.
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
 * Serialises the page, search and filter controls every admin list
 * shares.
 *
 * Empty strings are DROPPED, not sent. A `?search=` with nothing after
 * it would reach the API as an empty filter and, on a `contains` query,
 * match everything — which looks identical to no filter until someone
 * relies on it.
 */
export type AdminQueryValues = { [key: string]: string | number | boolean | undefined };

export function adminQuery(query: AdminQueryValues): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}

/**
 * A `type` alias rather than an `interface`, deliberately.
 *
 * TypeScript gives an implicit index signature to an object type alias
 * but not to an interface, so only this form is assignable to
 * `AdminQueryValues`. Declared as an interface, every call to
 * `adminQuery` below fails to compile.
 */
export type AdminListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
};

// ------------------------------------------------------------ identity

export function loadAdminUsers(
  query: AdminListQuery & { status?: string } = {}
): Promise<Loaded<Paginated<AdminUserItem>>> {
  return load<Paginated<AdminUserItem>>(`/admin/admin-users${adminQuery(query)}`);
}

// ----------------------------------------------------------- directory

export function loadAdminCompanies(
  query: AdminListQuery & { accountType?: string; verificationStatus?: string } = {}
): Promise<Loaded<Paginated<AdminCompanyItem>>> {
  return load<Paginated<AdminCompanyItem>>(`/admin/companies${adminQuery(query)}`);
}

export function loadAdminProducts(
  query: AdminListQuery & { approvalStatus?: string; companyId?: string; archived?: boolean } = {}
): Promise<Loaded<Paginated<AdminProductItem>>> {
  return load<Paginated<AdminProductItem>>(`/admin/products${adminQuery(query)}`);
}

/**
 * Every submitted bank account, not just the pending ones.
 *
 * `ibanLast4` is all the contract carries — the stored IBAN is encrypted
 * and its ciphertext and blind index are selected by no query behind
 * this shape.
 */
export function loadAdminBankAccounts(
  query: AdminListQuery & { verificationStatus?: string; companyId?: string } = {}
): Promise<Loaded<Paginated<AdminBankAccountItem>>> {
  return load<Paginated<AdminBankAccountItem>>(`/admin/bank-accounts/history${adminQuery(query)}`);
}

/** The queue: accounts awaiting a decision, oldest first. */
export function loadPendingBankAccounts(): Promise<Loaded<AdminBankAccountItem[]>> {
  return load<AdminBankAccountItem[]>("/admin/bank-accounts/pending-review");
}

/** Suppliers awaiting verification, oldest first. */
export function loadPendingSuppliers(): Promise<Loaded<AdminPendingSupplierItem[]>> {
  return load<AdminPendingSupplierItem[]>("/admin/operations/pending-suppliers");
}

/** Products awaiting review, oldest submission first. */
export function loadPendingProducts(): Promise<Loaded<AdminPendingProductItem[]>> {
  return load<AdminPendingProductItem[]>("/admin/products/pending-review");
}

/**
 * One report a trader filed about a product.
 *
 * Evidence is METADATA only — type, size, when it arrived. The storage
 * key is not on the projection behind this and is selected by no query;
 * the file itself is fetched through its own authorised endpoint.
 */
export interface AdminProductReportRow {
  id: string;
  productId: string;
  reporterCompanyId: string;
  reportedProductApprovalSnapshotId: string;
  reasonCode: string;
  reasonDetails: string | null;
  status: string;
  adminDecisionNote: string | null;
  resolvedByAdminId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  evidence: Array<{
    id: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
}

export function loadProductReports(
  status?: string
): Promise<Loaded<AdminProductReportRow[]>> {
  return load<AdminProductReportRow[]>(`/admin/products/reports${adminQuery({ status })}`);
}

// --------------------------------------------------------------- money

export function loadAdminRefunds(
  query: AdminListQuery & { status?: string } = {}
): Promise<Loaded<Paginated<AdminRefundItem>>> {
  return load<Paginated<AdminRefundItem>>(`/admin/refund-obligations${adminQuery(query)}`);
}

export function loadAdminRefund(id: string): Promise<Loaded<AdminRefundDetail>> {
  return load<AdminRefundDetail>(`/admin/refund-obligations/${encodeURIComponent(id)}`);
}

/**
 * The refund provider codes this deployment has registered.
 *
 * Read from the server so the refund screen offers what will actually be
 * asked to perform the transfer. A list hardcoded in the browser drifts
 * the moment a provider is added or removed, and a free-text field would
 * ask an operator to type an internal identifier from memory.
 */
export function loadRefundProviders(): Promise<Loaded<string[]>> {
  return load<string[]>("/admin/refund-obligations/providers");
}

/**
 * Payouts, as the operator who executed them sees them.
 *
 * This is the ONE surface that carries `externalTransferReference` — the
 * bank's reference for the transfer, which the operator needs to
 * reconcile it and which never travels to a supplier screen.
 */
export function loadAdminSettlements(
  query: AdminListQuery & { outcome?: string; supplierCompanyId?: string } = {}
): Promise<Loaded<Paginated<AdminSettlementItem>>> {
  return load<Paginated<AdminSettlementItem>>(`/admin/settlements${adminQuery(query)}`);
}

// -------------------------------------------------------------- orders

export function loadAdminOrders(
  query: {
    page?: number;
    pageSize?: number;
    status?: string;
    traderCompanyId?: string;
    supplierCompanyId?: string;
  } = {}
): Promise<Loaded<Paginated<AdminOrderItem>>> {
  return load<Paginated<AdminOrderItem>>(`/admin/orders${adminQuery(query)}`);
}

export function loadAdminOrder(id: string): Promise<Loaded<AdminOrderDetail>> {
  return load<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}`);
}

export function loadOrderInvoiceDrafts(
  masterOrderId: string
): Promise<Loaded<AdminInvoiceDocumentItem[]>> {
  return load<AdminInvoiceDocumentItem[]>(
    `/admin/orders/${encodeURIComponent(masterOrderId)}/invoice-drafts`
  );
}

export function loadPlatformBillingProfile(): Promise<
  Loaded<AdminPlatformBillingProfile | null>
> {
  return load<AdminPlatformBillingProfile | null>("/admin/platform-billing-profile");
}

// ------------------------------------------------------------ disputes

export function loadAdminDisputes(
  query: { page?: number; pageSize?: number; status?: string } = {}
): Promise<Loaded<Paginated<AdminDisputeItem>>> {
  return load<Paginated<AdminDisputeItem>>(`/admin/disputes${adminQuery(query)}`);
}

export function loadAdminDispute(id: string): Promise<Loaded<AdminDisputeDetail>> {
  return load<AdminDisputeDetail>(`/admin/disputes/${encodeURIComponent(id)}`);
}

// ------------------------------------------------------- opportunities

/**
 * The admin opportunity view, which is the service's own
 * `AdminOpportunityView` — a closed `ADMIN_SELECT` that predates this
 * portal. Typed here as the fields the screens actually read, so a
 * change to the service surfaces as a type error rather than as a blank
 * column.
 */
export interface AdminOpportunityRow {
  id: string;
  companyId: string;
  productId: string;
  status: string;
  targetQuantity: number;
  fundedQuantity: number;
  /** Fixed-scale decimal strings — see the money contract. */
  unitPriceAmount: string;
  unitPriceExclTaxAmount: string | null;
  unitTaxAmount: string | null;
  totalValueInclTaxAmount: string | null;
  taxRatePercent: string | null;
  currency: string;
  startAt: string;
  endAt: string;
  expectedPreparationDays: number;
  descriptionAr: string | null;
  descriptionEn: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
  cancelReason: string | null;
  blockedAt: string | null;
  reasonCode: string | null;
  reasonDetails: string | null;
  fulfillmentCityNameAr: string | null;
  fulfillmentCityNameEn: string | null;
  fulfillmentRegionNameAr: string | null;
  fulfillmentRegionNameEn: string | null;
  /**
   * Derived from an INTEGER basis-points column, so a number here is
   * exact — unlike the money fields above, which are strings.
   */
  sharePercentage: number | null;
  shareQuantity: number | null;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function loadAdminOpportunities(
  query: { page?: number; pageSize?: number; status?: string; companyId?: string } = {}
): Promise<Loaded<Paginated<AdminOpportunityRow>>> {
  return load<Paginated<AdminOpportunityRow>>(`/admin/opportunities${adminQuery(query)}`);
}

export function loadAdminOpportunity(id: string): Promise<Loaded<AdminOpportunityRow>> {
  return load<AdminOpportunityRow>(`/admin/opportunities/${encodeURIComponent(id)}`);
}

// ------------------------------------------------------ audit & outbox

export function loadAuditLogs(
  query: AdminListQuery & {
    actorType?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    requestId?: string;
  } = {}
): Promise<Loaded<Paginated<AuditLogEntry>>> {
  return load<Paginated<AuditLogEntry>>(`/admin/audit-logs${adminQuery(query)}`);
}

export function loadAuditActions(): Promise<Loaded<string[]>> {
  return load<string[]>("/admin/audit-logs/actions");
}

/**
 * Relay health.
 *
 * `providerMode` is on this contract and every screen must render it:
 * while it is a simulated mode nothing is delivered anywhere, and
 * `PUBLISHED` means the provider accepted the request, not that anything
 * arrived.
 */
export function loadOutboxStats(): Promise<Loaded<OutboxStats>> {
  return load<OutboxStats>("/admin/outbox/stats");
}

export interface IntegrationStatusRow {
  name: string;
  provider: string;
  mode: string;
  configState: string;
  healthState: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
}

export function loadIntegrations(): Promise<Loaded<IntegrationStatusRow[]>> {
  return load<IntegrationStatusRow[]>("/admin/integrations");
}

// ----------------------------------------------------------- reference

export function loadAdminTaxonomy(): Promise<Loaded<AdminTaxonomyNodeItem[]>> {
  return load<AdminTaxonomyNodeItem[]>("/admin/taxonomy");
}

export function loadAdminSalesUnits(): Promise<Loaded<AdminSalesUnitItem[]>> {
  return load<AdminSalesUnitItem[]>("/admin/sales-units");
}

export function loadAdminRegions(): Promise<Loaded<AdminRegionItem[]>> {
  return load<AdminRegionItem[]>("/admin/regions");
}

export function loadAdminCities(): Promise<Loaded<AdminCityItem[]>> {
  return load<AdminCityItem[]>("/admin/cities");
}

// --------------------------------------------------- brand & content

export function loadAdminBranding(): Promise<Loaded<AdminBrandingView | null>> {
  return load<AdminBrandingView | null>("/admin/branding");
}

/**
 * Active colours, the unpublished draft, the defaults, and the contrast
 * verdict for each.
 *
 * `BrandThemeAdminView` is the API's own closed contract, so it is used
 * directly. The contrast validation travels with the colours rather
 * than being recomputed here: whether a palette is legible is decided
 * once, by the code that will refuse to publish it.
 */
export function loadAdminBrandTheme(): Promise<Loaded<BrandThemeAdminView>> {
  return load<BrandThemeAdminView>("/admin/branding/theme");
}

/** One banner as the admin list renders it — `hasImage`, never a key. */
export interface AdminBannerRow {
  id: string;
  placement: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string | null;
  bodyEn: string | null;
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  hasImage: boolean;
  state: string;
  imageWidth: number | null;
  imageHeight: number | null;
  createdAt: string;
  updatedAt: string;
}

export function loadAdminBanners(placement: string): Promise<Loaded<AdminBannerRow[]>> {
  return load<AdminBannerRow[]>(`/admin/banners${adminQuery({ placement })}`);
}

/**
 * The site content the homepage and header read.
 *
 * The same endpoint the public site uses. The admin screen deliberately
 * reads what visitors get rather than the raw settings rows, so an
 * operator sees the effect of a saved value — including a nav entry
 * silently dropped because its taxonomy node was deactivated.
 */
export function loadSiteContent(): Promise<Loaded<SiteContent>> {
  return load<SiteContent>("/public/site-content");
}

// ------------------------------------------------------------ settings

/**
 * One setting from the registry.
 *
 * The registry shape is already closed — `{key, type, description,
 * adminWritable, allowedValues, value}` — so it is used as-is rather
 * than wrapped again. `adminWritable` is the field the UI must honour: a
 * setting marked false is displayed read-only, and the server refuses
 * the write regardless.
 */
export interface AdminSettingItem {
  key: string;
  type: string;
  description: string;
  adminWritable: boolean;
  allowedValues?: readonly string[];
  value: unknown;
}

export function loadAdminSettings(): Promise<Loaded<AdminSettingItem[]>> {
  return load<AdminSettingItem[]>("/admin/settings");
}

export function loadAdminSetting(key: string): Promise<Loaded<AdminSettingItem>> {
  return load<AdminSettingItem>(`/admin/settings/${encodeURIComponent(key)}`);
}
