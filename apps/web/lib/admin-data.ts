import { cookies } from "next/headers";
import type {
  AdminCompanyDetail,
  AdminOrderRow,
  AdminOrderStageInsight,
  DashboardOverview,
  FollowUpBoard,
  AdminCompanyTabCounts,
  CompanyDeletionEligibility,
  AdminBrandingView,
  BrandThemeAdminView,
  AdminCityItem,
  AdminCompanyItem,
  AdminCompanyName,
  AdminDisputeDetail,
  AdminDisputeItem,
  AdminInvoiceDocumentItem,
  AdminOrderDetail,
  AdminPlatformBillingProfile,
  AdminPolicyDocument,
  AdminProductDetail,
  AdminProductItem,
  AdminRefundDetail,
  AdminRefundItem,
  AdminRegionItem,
  AdminSalesUnitItem,
  AdminSettlementItem,
  AdminTaxonomyNodeItem,
  AdminUserItem,
  AuditLogEntry,
  FooterConfig,
  OutboxStats,
  Paginated,
  SiteContent,
} from "@platform/types";
import {
  BANNER_POLICY_SETTING_KEY,
  type BannerImageLocale,
  type BrandAssetsAdminView,
  DEFAULT_BANNER_IMAGE_SHAPE,
  isBannerImageShape,
  type BannerImageShape,
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

export type Loaded<T> =
  { ok: true; data: T } | { ok: false; error: UserFacingError };

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
      data: await apiClient.get<T>(path, {
        cache: "no-store",
        cookieHeader: header,
      }),
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
export type AdminQueryValues = {
  [key: string]: string | number | boolean | undefined;
};

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
  query: AdminListQuery & { status?: string } = {},
): Promise<Loaded<Paginated<AdminUserItem>>> {
  return load<Paginated<AdminUserItem>>(
    `/admin/admin-users${adminQuery(query)}`,
  );
}

// ----------------------------------------------------------- directory

export function loadAdminCompanies(
  query: AdminListQuery & {
    accountType?: string;
    verificationStatus?: string;
    operationalStatus?: string;
    registeredFrom?: string;
    registeredTo?: string;
  } = {},
): Promise<Loaded<Paginated<AdminCompanyItem>>> {
  return load<Paginated<AdminCompanyItem>>(
    `/admin/companies${adminQuery(query)}`,
  );
}

/**
 * How many buyers and how many suppliers the current search matches.
 *
 * Read separately from the page itself so a tab's badge describes what
 * switching to it would show, rather than the tab already open.
 */
export function loadAdminCompanyTabCounts(
  query: {
    search?: string;
    verificationStatus?: string;
    operationalStatus?: string;
    registeredFrom?: string;
    registeredTo?: string;
  } = {},
): Promise<Loaded<AdminCompanyTabCounts>> {
  return load<AdminCompanyTabCounts>(
    `/admin/companies/tab-counts${adminQuery(query)}`,
  );
}

/**
 * Everything the overview shows, in ONE read.
 *
 * The screen this replaces called six list endpoints and counted their
 * lengths, which made "how many suppliers are waiting" a number that
 * depended on a page size.
 */
export function loadDashboardOverview(
  period: string,
): Promise<Loaded<DashboardOverview>> {
  return load<DashboardOverview>(
    `/admin/dashboard/overview?period=${encodeURIComponent(period)}`,
  );
}

/** The four stages of the orders screen. */
export function loadOrderInsights(
  period: string,
): Promise<Loaded<AdminOrderStageInsight>> {
  return load<AdminOrderStageInsight>(
    `/admin/orders/insights?period=${encodeURIComponent(period)}`,
  );
}

/** The rows beneath those stages, on the orders-detail screen. */
export function loadOrderRows(
  query: AdminListQuery & { period?: string; stage?: string } = {},
): Promise<Loaded<Paginated<AdminOrderRow>>> {
  return load<Paginated<AdminOrderRow>>(
    `/admin/orders/list${adminQuery(query)}`,
  );
}

/** The cases needing an administrator, and the four cards over them. */
export function loadFollowUpBoard(
  query: AdminListQuery & {
    period?: string;
    priority?: string;
    kind?: string;
    assignee?: string;
  } = {},
): Promise<Loaded<FollowUpBoard>> {
  return load<FollowUpBoard>(`/admin/follow-up${adminQuery(query)}`);
}

/** One company, with its people, its branches and what it is entangled with. */
/**
 * EVERY COMPANY OF ONE KIND, AS A NAME AND AN ID.
 *
 * The source behind a chooser — «خيار اختيار اسم المنشأة» — and
 * nothing else. Two columns, unpaged: a chooser that stopped at a
 * page would silently be unable to find half the platform.
 */
export function loadAdminCompanyNames(
  accountType?: string,
): Promise<Loaded<AdminCompanyName[]>> {
  return load<AdminCompanyName[]>(
    `/admin/companies/names${accountType ? `?accountType=${accountType}` : ""}`,
  );
}

export function loadAdminCompany(
  id: string,
): Promise<Loaded<AdminCompanyDetail>> {
  return load<AdminCompanyDetail>(`/admin/companies/${encodeURIComponent(id)}`);
}

/**
 * Whether this company can be removed, and what stops it.
 *
 * Read for the screen; the delete route runs the SAME check inside its
 * own transaction, so this is what the button reflects rather than what
 * the rule is.
 */
export function loadCompanyDeletionEligibility(
  id: string,
): Promise<Loaded<CompanyDeletionEligibility>> {
  return load<CompanyDeletionEligibility>(
    `/admin/companies/${encodeURIComponent(id)}/deletion-eligibility`,
  );
}

export function loadAdminProducts(
  query: AdminListQuery & {
    approvalStatus?: string;
    companyId?: string;
    archived?: boolean;
  } = {},
): Promise<Loaded<Paginated<AdminProductItem>>> {
  return load<Paginated<AdminProductItem>>(
    `/admin/products${adminQuery(query)}`,
  );
}

/**
 * One product, whole.
 *
 * The register carries what a LIST needs — name, supplier, state, how
 * many pictures. This is everything a decision needs: the description,
 * the measurements, what a package holds, the branch it sits under, the
 * images themselves, and the count of offers a buyer can currently
 * reach.
 */
export function loadAdminProduct(
  id: string,
): Promise<Loaded<AdminProductDetail>> {
  return load<AdminProductDetail>(`/admin/products/${encodeURIComponent(id)}`);
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
  status?: string,
): Promise<Loaded<AdminProductReportRow[]>> {
  return load<AdminProductReportRow[]>(
    `/admin/products/reports${adminQuery({ status })}`,
  );
}

// --------------------------------------------------------------- money

export function loadAdminRefunds(
  query: AdminListQuery & { status?: string } = {},
): Promise<Loaded<Paginated<AdminRefundItem>>> {
  return load<Paginated<AdminRefundItem>>(
    `/admin/refund-obligations${adminQuery(query)}`,
  );
}

export function loadAdminRefund(
  id: string,
): Promise<Loaded<AdminRefundDetail>> {
  return load<AdminRefundDetail>(
    `/admin/refund-obligations/${encodeURIComponent(id)}`,
  );
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
  query: AdminListQuery & { outcome?: string; supplierCompanyId?: string } = {},
): Promise<Loaded<Paginated<AdminSettlementItem>>> {
  return load<Paginated<AdminSettlementItem>>(
    `/admin/settlements${adminQuery(query)}`,
  );
}

// -------------------------------------------------------------- orders

export function loadAdminOrder(id: string): Promise<Loaded<AdminOrderDetail>> {
  return load<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}`);
}

export function loadOrderInvoiceDrafts(
  masterOrderId: string,
): Promise<Loaded<AdminInvoiceDocumentItem[]>> {
  return load<AdminInvoiceDocumentItem[]>(
    `/admin/orders/${encodeURIComponent(masterOrderId)}/invoice-drafts`,
  );
}

export function loadPlatformBillingProfile(): Promise<
  Loaded<AdminPlatformBillingProfile | null>
> {
  return load<AdminPlatformBillingProfile | null>(
    "/admin/platform-billing-profile",
  );
}

// ------------------------------------------------------------ disputes

export function loadAdminDisputes(
  query: { page?: number; pageSize?: number; status?: string } = {},
): Promise<Loaded<Paginated<AdminDisputeItem>>> {
  return load<Paginated<AdminDisputeItem>>(
    `/admin/disputes${adminQuery(query)}`,
  );
}

export function loadAdminDispute(
  id: string,
): Promise<Loaded<AdminDisputeDetail>> {
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
  query: {
    page?: number;
    pageSize?: number;
    status?: string;
    companyId?: string;
  } = {},
): Promise<Loaded<Paginated<AdminOpportunityRow>>> {
  return load<Paginated<AdminOpportunityRow>>(
    `/admin/opportunities${adminQuery(query)}`,
  );
}

export function loadAdminOpportunity(
  id: string,
): Promise<Loaded<AdminOpportunityRow>> {
  return load<AdminOpportunityRow>(
    `/admin/opportunities/${encodeURIComponent(id)}`,
  );
}

// ------------------------------------------------------ audit & outbox

export function loadAuditLogs(
  query: AdminListQuery & {
    actorType?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    requestId?: string;
  } = {},
): Promise<Loaded<Paginated<AuditLogEntry>>> {
  return load<Paginated<AuditLogEntry>>(
    `/admin/audit-logs${adminQuery(query)}`,
  );
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

/**
 * The footer: what is published, what is drafted, and which policy
 * documents actually exist.
 *
 * The last of those is what lets the screen warn that an enabled Terms
 * link will not appear on the site. It is decided by the server —
 * whether a document is published is a fact about the database, and the
 * console must not have its own opinion about it.
 */
export interface AdminFooterView {
  published: FooterConfig;
  draft: FooterConfig | null;
  draftUpdatedAt: string | null;
  publishedPolicyCodes: string[];
}

export function loadAdminFooter(): Promise<Loaded<AdminFooterView>> {
  return load<AdminFooterView>("/admin/branding/footer");
}

/** One banner as the admin list renders it — `hasImage`, never a key. */
export interface AdminBannerRow {
  id: string;
  placement: string;
  /**
   * Which languages have artwork. A banner needs both before it can go
   * live, so this is what the screen reads to say which upload is still
   * outstanding.
   *
   * No titles and no body: a banner is artwork, and every word a
   * visitor reads is drawn inside the picture.
   */
  images: BannerImageLocale[];
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  state: string;
  createdAt: string;
  updatedAt: string;
}

export function loadAdminBanners(
  placement: string,
): Promise<Loaded<AdminBannerRow[]>> {
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

/**
 * The platform legal documents, every version of each.
 *
 * The published ones are what the public viewer and registration read;
 * the drafts are what nobody outside this console can see.
 */
export function loadAdminPolicies(): Promise<Loaded<AdminPolicyDocument[]>> {
  return load<AdminPolicyDocument[]>("/admin/policies");
}

/**
 * Whether registration is currently possible at all.
 *
 * Registration refuses outright when no mandatory published policy
 * exists. Read here so the screen that can cause that says so.
 */
export function loadPolicyRegistrationReadiness(): Promise<
  Loaded<{ mandatoryPublished: number; registrationOpen: boolean }>
> {
  return load<{ mandatoryPublished: number; registrationOpen: boolean }>(
    "/admin/policies/registration-readiness",
  );
}

export function loadAdminSettings(): Promise<Loaded<AdminSettingItem[]>> {
  return load<AdminSettingItem[]>("/admin/settings");
}

export function loadAdminSetting(
  key: string,
): Promise<Loaded<AdminSettingItem>> {
  return load<AdminSettingItem>(`/admin/settings/${encodeURIComponent(key)}`);
}

/* ===================================================================
   THE THIRTEEN TYPED SETTINGS GROUPS

   Each of these has its own endpoint with its own bounds, and several
   are policy-VERSIONED — writing one appends a new version rather than
   overwriting a row, which is why the reads carry a `version` the
   screen can show. The generic registry above deliberately excludes
   them (see the settings screen's own note): a second, unvalidated way
   to write a commission rate is exactly what that boundary prevents.

   The shapes here mirror the API's return types exactly. Where a bound
   appears in a form it is quoted from the DTO, never guessed — the
   server re-validates regardless, and a form that allows what the
   server refuses is a form that wastes a round trip to say so.
   =================================================================== */

export interface RateLimitConfig {
  limit: number;
  ttlSeconds: number;
}

export interface AdminSecuritySettings {
  loginRateLimit: RateLimitConfig;
  twoFaRateLimit: RateLimitConfig;
  sessionDurationSeconds: number;
}

/** `ratePercent` is null when a default rate has never been set. */
export interface TaxRateSetting {
  ratePercent: number | null;
  version: number | null;
}

export interface CommissionPolicy {
  id: string;
  version: number;
  rateBasisPoints: number;
}

export interface CommissionTaxPolicy {
  id: string;
  version: number;
  ratePercent: number;
  ruleCode: string;
  ruleVersion: string;
}

export interface ShareTier {
  /** null on the final, open-ended tier. */
  maxTotalValueInclTax: number | null;
  shareBasisPoints: number;
}

export interface ShareTierPolicy {
  id: string;
  version: number;
  tiers: ShareTier[];
}

export interface ShippingTariffPolicy {
  id: string;
  version: number;
  sameCityFeeAmount: number;
  sameRegionDifferentCityFeeAmount: number;
  differentRegionFeeAmount: number;
  /** Set by the platform, not by this screen. */
  providerCode: string;
}

export interface CheckoutSettings {
  lockDurationMinutes: number;
  abuseThresholdCount: number;
  abuseWindowMinutes: number;
  cooldownMinutes: number;
}

export interface PaymentSettings {
  paymentAttemptTimeoutMinutes: number;
}

export interface FulfillmentSettings {
  lateThresholdPercent: number;
  criticalThresholdPercent: number;
}

export interface OpportunitySettings {
  minDurationHours: number;
  maxDurationDays: number;
  minTargetQuantity: number;
  maxTargetQuantity: number;
  showScheduledPubliclyEnabled: boolean;
  /**
   * How many days one extension adds. HOW MANY TIMES a listing may be
   * extended is not configurable and is not here — see the note on
   * `extend()` in the API.
   */
  extensionDays: number;
}

export interface MediaPolicySettings {
  maxSizeBytes: number;
  maxImagesPerProduct: number;
  allowedTypes: string[];
  maxPixels: number;
}

export const loadSecuritySettings = () =>
  load<AdminSecuritySettings>("/admin/settings/security");
export const loadPayoutHoldDays = () =>
  load<{ days: number }>("/admin/settings/security/payout-hold-days");
export const loadTaxRate = () => load<TaxRateSetting>("/admin/settings/tax");
export const loadCommissionPolicy = () =>
  load<CommissionPolicy>("/admin/settings/commission");
export const loadCommissionTaxPolicy = () =>
  load<CommissionTaxPolicy>("/admin/settings/commission-tax");
export const loadShareTierPolicy = () =>
  load<ShareTierPolicy>("/admin/settings/share-tiers");
export const loadShippingTariff = () =>
  load<ShippingTariffPolicy>("/admin/settings/shipping-tariff");
export const loadCheckoutSettings = () =>
  load<CheckoutSettings>("/admin/settings/checkout");
export const loadPaymentSettings = () =>
  load<PaymentSettings>("/admin/settings/payment");
export const loadFulfillmentSettings = () =>
  load<FulfillmentSettings>("/admin/settings/fulfillment");
export const loadOpportunitySettings = () =>
  load<OpportunitySettings>("/admin/settings/opportunity");
export const loadMediaPolicy = () =>
  load<MediaPolicySettings>("/admin/settings/media-policy");

/**
 * The image shape the banner policy currently enforces.
 *
 * Read from the LIVE policy rather than restated here. The admin screen
 * checks a picked file against these numbers before uploading, and if
 * this client carried its own copy, an operator who widened the policy
 * would still be refused by a screen that had not heard about it.
 *
 * A failed or malformed read falls back to the shipped default — the
 * same constant the server falls back to, not a second set of numbers.
 * The consequence of being wrong here is a round-trip: the server
 * re-checks every upload and its refusal is the one that decides.
 */
export async function loadBannerImageShape(): Promise<BannerImageShape> {
  const loaded = await loadAdminSetting(BANNER_POLICY_SETTING_KEY);
  if (!loaded.ok) return DEFAULT_BANNER_IMAGE_SHAPE;

  const value = loaded.data.value;
  if (typeof value !== "object" || value === null)
    return DEFAULT_BANNER_IMAGE_SHAPE;

  const shape = (value as { imageShape?: unknown }).imageShape;
  return isBannerImageShape(shape) ? shape : DEFAULT_BANNER_IMAGE_SHAPE;
}

/**
 * The header logo set, for the identity screen.
 *
 * No object keys and no public URLs: the view says which languages have
 * a logo, whether the set is complete, and whether it is published. The
 * previews are fetched from the admin route by locale.
 */
export function loadBrandLogos(): Promise<Loaded<BrandAssetsAdminView>> {
  return load<BrandAssetsAdminView>("/admin/branding/logo");
}
