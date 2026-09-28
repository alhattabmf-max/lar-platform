import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  COMPANY_OPERATIONAL_STATUSES,
  COMPANY_VERIFICATION_STATUSES_ADMIN,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadAdminCompanies,
  loadAdminCompanyTabCounts,
} from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { DataTablePagination } from "@/components/admin/data-table-pagination";
import { RegisterTabs } from "@/components/admin/register-tabs";
import { CopyValue } from "@/components/admin/copy-value";
import { CompanyWorkbookActions } from "@/components/admin/company-workbook-actions";
import { parsePageSize } from "@/lib/admin-list-query";
import {
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * Every company on the platform, in the two halves it actually has.
 *
 * ONE SIDEBAR ENTRY, TWO TABS. A buyer and a supplier are the same kind
 * of record with different columns and different questions asked of
 * them, but an operator handed a name does not always know which they
 * are looking for — so splitting the navigation would make them guess
 * before they could look.
 *
 * THE TAB IS THE ACCOUNT-TYPE FILTER. Not a second piece of state
 * beside it: `?accountType=SUPPLIER` IS the suppliers tab. One value
 * cannot disagree with itself, and the export, the import and the table
 * all read the same parameter.
 *
 * VERIFICATION BELONGS TO SUPPLIERS ALONE. A buyer is never verified,
 * has no verification status worth showing and no approve or reject to
 * offer — so the column, the filter and every such action are absent
 * from that tab rather than disabled in it.
 *
 * THE NAME IS THE ONLY DOOR. There is no actions column and no
 * three-dot menu: two controls that both mean "open this company" is
 * one more than the screen needs, and a whole-row click opens companies
 * an operator was only trying to select text in.
 */

const TABS = [
  { key: "traders", accountType: "TRADER" },
  { key: "suppliers", accountType: "SUPPLIER" },
] as const;


/**
 * The tab's name. The layout supplies « | لوحة التحكم ».
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as AppLocale,
    namespace: "admin.companies",
  });
  return { title: t("title") };
}

export default async function AdminCompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.companies",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });
  const filters = await getTranslations({
    locale: appLocale,
    namespace: "admin.filters",
  });
  const toolbar = await getTranslations({
    locale: appLocale,
    namespace: "admin.toolbar",
  });
  const vocab = await getTranslations({
    locale: appLocale,
    namespace: "admin.vocab",
  });

  const page = parseAdminPage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  const search = firstParam(query.search);
  const verificationStatus = firstParam(query.verificationStatus);
  const operationalStatus = firstParam(query.operationalStatus);
  const registeredFrom = firstParam(query.registeredFrom);
  const registeredTo = firstParam(query.registeredTo);

  // Buyers unless the URL says otherwise — the larger register, and the
  // one an operator lands on most.
  const requested = firstParam(query.accountType);
  const accountType = requested === "SUPPLIER" ? "SUPPLIER" : "TRADER";
  const isSupplierTab = accountType === "SUPPLIER";

  const basePath = `/${appLocale}/admin/companies`;

  // A verification filter carried onto the buyers' tab would narrow a
  // list by a field that tab does not have. It is dropped there rather
  // than silently applied.
  const effectiveStatus = isSupplierTab ? verificationStatus : undefined;

  // THE CHOOSER ASKS THE SERVER AS THE OPERATOR TYPES — «أضف خيار
  // اختيار اسم المنشأة في بطاقة بحث المشترين واسم المنشأة في بطاقة بحث
  // المورّد».
  //
  // PER TAB, because a chooser listing suppliers on the buyers' tab
  // would offer a choice that empties the table — the account type is
  // carried on the path the control queries.

  const counts = await loadAdminCompanyTabCounts({
    search,
    verificationStatus: effectiveStatus,
    operationalStatus,
    registeredFrom,
    registeredTo,
  });

  function tabHref(type: string) {
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    // Switching tabs returns to page one: page four of the buyers is
    // not page four of the suppliers.
    next.set("accountType", type);
    // The filters BOTH registers have are carried across; the one only
    // the suppliers have is not, because the buyers have no field it
    // could narrow.
    if (operationalStatus) next.set("operationalStatus", operationalStatus);
    if (registeredFrom) next.set("registeredFrom", registeredFrom);
    if (registeredTo) next.set("registeredTo", registeredTo);
    if (type === "SUPPLIER" && verificationStatus) {
      next.set("verificationStatus", verificationStatus);
    }
    const suffix = next.toString();
    return suffix ? `${basePath}?${suffix}` : basePath;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* STILL A HEADING, just not a second copy of the sidebar.
          Reading it off the screen was redundant; reading it with a
          screen reader is how somebody knows which page they landed
          on, because they cannot see which sidebar entry is lit. */}
      <h1 className="sr-only">{t("title")}</h1>

      <ListToolbar
        // EVERY CONTROL THIS REGISTER HAS, ON ONE ROW — «الأزرار اللي
        // تحت الأربعة بما فيهم البحث، ارفعها موازية للمشترون
        // والموردون».
        //
        // It was three rows: the two tabs in a sunken track, then the
        // export, the template and the import, then the search. Six
        // controls, none of them tall, spending three rows of the page
        // above the first company. They are one row now, and the
        // search stays at the far end where the reader's eye finishes.
        actions={
          <>
            <RegisterTabs
              label={t("tabsLabel")}
              tabs={TABS.map((tab) => ({
                key: tab.key,
                label: t(`tab.${tab.key}`),
                href: tabHref(tab.accountType),
                count: counts.ok
                  ? tab.key === "traders"
                    ? counts.data.traders
                    : counts.data.suppliers
                  : null,
                active: accountType === tab.accountType,
              }))}
            />

            <CompanyWorkbookActions
              accountType={accountType}
              query={workbookQuery(
                search,
                effectiveStatus,
                accountType,
                operationalStatus,
                registeredFrom,
                registeredTo,
              )}
              exportColumns={
                isSupplierTab
                  ? [
                      t("legalName"),
                      t("crNumber"),
                      t("verificationStatus"),
                      t("ownerEmail"),
                      t("userCount"),
                      t("productCount"),
                      t("opportunityCount"),
                      t("createdAt"),
                    ]
                  : [
                      t("legalName"),
                      t("crNumber"),
                      t("ownerEmail"),
                      t("userCount"),
                      t("orderCount"),
                      t("createdAt"),
                    ]
              }
              exportFileLabel={t(`tab.${isSupplierTab ? "suppliers" : "traders"}`)}
              statusLabels={Object.fromEntries(
                COMPANY_VERIFICATION_STATUSES_ADMIN.map((value) => [
                  value,
                  vocab(`companyVerification.${value}`),
                ]),
              )}
              empty={
                counts.ok &&
                (isSupplierTab ? counts.data.suppliers : counts.data.traders) === 0
              }
              labels={await workbookLabels(appLocale)}
            />
          </>
        }
        // Remounts on a tab change so the open filter panel does not
        // carry a control the new tab does not have.
        key={accountType}
        labels={{
          regionLabel: toolbar("regionLabel"),
          openLabel: filters("search"),
          searchLabel: filters("search"),
          searchPlaceholder: toolbar("searchPlaceholder"),
          filtersPanelLabel: toolbar("filtersPanelLabel"),
          reset: toolbar("reset"),
        }}
        selects={[
          // A NAME IS CHOSEN, NOT TYPED — «الخيارات اللي قلت أضفها لا
          // تجعلها قابلة للكتابة، خلّها نفس نظام الحالة».
          //
          // The search box beside it still takes a fragment — a
          // registration, half a name — and this is for when the
          // reader knows exactly which company they want. Choosing
          // writes the same `search` parameter, because the exact
          // legal name IS the narrowest search there is; two
          // parameters meaning «which company» would be two ways for
          // a link to disagree with itself.
          {
            name: "search",
            label: t("legalName"),
            // THE OPTIONS ARE NOT KNOWN HERE, and that is the change: the
            // chooser used to be filled by fetching every company name,
            // which at 70,000 companies was 5.8 MB per page load.
            options: [],
            remote: {
              path: `/admin/companies/names${accountType ? `?accountType=${accountType}` : ""}`,
              hint: toolbar("searchPlaceholder"),
            },
          },
          // VERIFICATION IS THE SUPPLIERS' ALONE, and it comes first
          // because it is the question most often asked of that tab.
          ...(isSupplierTab
            ? [
                {
                  name: "verificationStatus",
                  label: t("verificationStatus"),
                  options: [
                    { value: "", label: filters("any") },
                    ...COMPANY_VERIFICATION_STATUSES_ADMIN.map((value) => ({
                      value,
                      label: vocab(`companyVerification.${value}`),
                    })),
                  ],
                },
              ]
            : []),
          // Running or stopped, which both registers have.
          {
            name: "operationalStatus",
            label: t("operationalStatus"),
            options: [
              { value: "", label: filters("any") },
              ...COMPANY_OPERATIONAL_STATUSES.map((value) => ({
                value,
                label: t(`operational.${value}`),
              })),
            ],
          },
        ]}
        dates={[
          { name: "registeredFrom", label: t("registeredFrom") },
          { name: "registeredTo", label: t("registeredTo") },
        ]}
      />

      <Suspense
        key={[
          accountType,
          page,
          pageSize,
          search ?? "",
          effectiveStatus ?? "",
          operationalStatus ?? "",
          registeredFrom ?? "",
          registeredTo ?? "",
        ].join(":")}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Companies
          locale={appLocale}
          basePath={basePath}
          page={page}
          pageSize={pageSize}
          search={search}
          accountType={accountType}
          verificationStatus={effectiveStatus}
          operationalStatus={operationalStatus}
          registeredFrom={registeredFrom}
          registeredTo={registeredTo}
        />
      </Suspense>
    </div>
  );
}

/** The filters an export and an import must carry, and nothing else. */
function workbookQuery(
  search: string | undefined,
  verificationStatus: string | undefined,
  accountType: string,
  operationalStatus: string | undefined,
  registeredFrom: string | undefined,
  registeredTo: string | undefined,
): string {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  query.set("accountType", accountType);
  if (verificationStatus) query.set("verificationStatus", verificationStatus);
  if (operationalStatus) query.set("operationalStatus", operationalStatus);
  if (registeredFrom) query.set("registeredFrom", registeredFrom);
  if (registeredTo) query.set("registeredTo", registeredTo);
  return `?${query.toString()}`;
}

async function workbookLabels(locale: AppLocale) {
  const workbook = await getTranslations({
    locale,
    namespace: "admin.companyWorkbook",
  });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });
  const states = await getTranslations({ locale, namespace: "states" });

  const reasonKeys = [
    "MISSING_CRNUMBER",
    "MISSING_LEGALNAME",
    "MISSING_ACCOUNTTYPE",
    "MISSING_OWNEREMAIL",
    "MISSING_PRIMARYMOBILE1",
    "MISSING_PRIMARYMOBILE2",
    "INVALID_CR_FORMAT",
    "INVALID_EMAIL",
    "INVALID_ACCOUNT_TYPE",
    "INVALID_PRIMARYMOBILE1",
    "INVALID_PRIMARYMOBILE2",
    "DUPLICATE_CR_IN_FILE",
    "DUPLICATE_EMAIL_IN_FILE",
    "CR_ALREADY_REGISTERED",
    "EMAIL_ALREADY_REGISTERED",
  ] as const;

  return {
    exportAction: workbook("exportAction"),
    exportEmpty: workbook("exportEmpty"),
    templateAction: workbook("templateAction"),
    importAction: workbook("importAction"),
    previewTitle: workbook("previewTitle"),
    previewFile: workbook("previewFile"),
    previewTotal: workbook("previewTotal"),
    previewValid: workbook("previewValid"),
    previewRejected: workbook("previewRejected"),
    previewDuplicates: workbook("previewDuplicates"),
    previewNothing: workbook("previewNothing"),
    previewPartial: workbook("previewPartial"),
    previewAll: workbook("previewAll"),
    rowsTitle: workbook("rowsTitle"),
    rowNumber: workbook("rowNumber"),
    rowReason: workbook("rowReason"),
    downloadErrors: workbook("downloadErrors"),
    commitAction: workbook("commitAction"),
    cancel: actions("cancel"),
    working: actions("working"),
    doneTitle: workbook("doneTitle"),
    doneCreated: workbook("doneCreated"),
    doneSkipped: workbook("doneSkipped"),
    doneInvited: workbook("doneInvited"),
    close: workbook("close"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
    unknownReason: workbook("unknownReason"),
    reasons: Object.fromEntries(
      reasonKeys.map((key) => [key, workbook(`reasons.${key}`)]),
    ),
  };
}

async function Companies({
  locale,
  basePath,
  page,
  pageSize,
  search,
  accountType,
  verificationStatus,
  operationalStatus,
  registeredFrom,
  registeredTo,
}: {
  locale: AppLocale;
  basePath: string;
  page: number;
  pageSize: number;
  search?: string;
  accountType: "TRADER" | "SUPPLIER";
  verificationStatus?: string;
  operationalStatus?: string;
  registeredFrom?: string;
  registeredTo?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.companies" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const toolbar = await getTranslations({ locale, namespace: "admin.toolbar" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminCompanies({
    page,
    pageSize,
    search,
    accountType,
    verificationStatus,
    operationalStatus,
    registeredFrom,
    registeredTo,
  });

  if (!result.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={result.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (result.data.total === 0) {
    return (
      <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
    );
  }

  const isSupplier = accountType === "SUPPLIER";

  // WHAT THE READER IS LOOKING AT, carried into each row's link, so the
  // detail page's breadcrumb can bring them back to this exact tab,
  // search, filters, page and page size. Encoded once here rather than
  // rebuilt per row.
  const returnTo = new URLSearchParams();
  returnTo.set("accountType", accountType);
  if (search) returnTo.set("search", search);
  if (verificationStatus)
    returnTo.set("verificationStatus", verificationStatus);
  if (operationalStatus) returnTo.set("operationalStatus", operationalStatus);
  if (registeredFrom) returnTo.set("registeredFrom", registeredFrom);
  if (registeredTo) returnTo.set("registeredTo", registeredTo);
  if (page > 1) returnTo.set("page", String(page));
  if (pageSize !== 25) returnTo.set("pageSize", String(pageSize));
  const backLink = `?from=${encodeURIComponent(returnTo.toString())}`;

  const from = (result.data.page - 1) * result.data.pageSize + 1;
  const to = Math.min(
    result.data.page * result.data.pageSize,
    result.data.total,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Wide tables scroll inside their own container, so the page body
          never scrolls sideways at 360px. */}
      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <Table
          caption={t(
            isSupplier ? "tableCaptionSuppliers" : "tableCaptionTraders",
          )}
        >
          <THead>
            <TR>
              <TH>{t("legalName")}</TH>
              <TH>{t("crNumber")}</TH>
              {isSupplier ? <TH>{t("verificationStatus")}</TH> : null}
              <TH>{t("ownerEmail")}</TH>
              <TH>{t("userCount")}</TH>
              {isSupplier ? <TH>{t("productCount")}</TH> : null}
              {isSupplier ? (
                <TH>{t("opportunityCount")}</TH>
              ) : (
                <TH>{t("orderCount")}</TH>
              )}
              <TH>{t("createdAt")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((company) => (
              <TR key={company.id}>
                <TD>
                  {/* THE ONE WAY IN. No menu beside it offering the same
                      thing, and no whole-row handler around it. */}
                  <Link
                    href={`${basePath}/${company.id}${backLink}`}
                    className="rounded-sm font-medium text-content underline underline-offset-2 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    data-testid={`company-link-${company.id}`}
                  >
                    {company.legalName}
                  </Link>
                </TD>
                {/* A registration is digits that must not reorder in an
                    Arabic row, and must never lose a leading zero. */}
                <TD className="font-mono text-xs">
                  <span dir="ltr">{company.crNumber}</span>
                </TD>
                {isSupplier ? (
                  <TD>
                    <StatusBadge
                      label={vocab(
                        `companyVerification.${company.verificationStatus}`,
                      )}
                      tone={
                        company.verificationStatus === "VERIFIED"
                          ? "done"
                          : company.verificationStatus ===
                              "PENDING_VERIFICATION"
                            ? "attention"
                            : "neutral"
                      }
                    />
                  </TD>
                ) : null}
                <TD className="max-w-[18rem]">
                  {company.ownerEmail ? (
                    <CopyValue
                      value={company.ownerEmail}
                      copyLabel={t("copyEmail")}
                      copiedLabel={t("copiedEmail")}
                      testId={`company-email-${company.id}`}
                    />
                  ) : (
                    // No owner recorded shows an em dash, never an
                    // invented placeholder.
                    "—"
                  )}
                </TD>
                <TD className="tabular-nums">
                  <span dir="ltr">{company.userCount}</span>
                </TD>
                {isSupplier ? (
                  <TD className="tabular-nums">
                    <span dir="ltr">{company.productCount ?? "—"}</span>
                  </TD>
                ) : null}
                <TD className="tabular-nums">
                  <span dir="ltr">
                    {isSupplier
                      ? (company.opportunityCount ?? "—")
                      : (company.orderCount ?? "—")}
                  </span>
                </TD>
                <TD>
                  <time dateTime={company.createdAt}>
                    {formatDate(company.createdAt, locale)}
                  </time>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <DataTablePagination
        page={result.data.page}
        pageSize={result.data.pageSize}
        total={result.data.total}
        labels={{
          navLabel: pagination("navLabel"),
          first: pagination("first"),
          previous: pagination("previous"),
          next: pagination("next"),
          last: pagination("last"),
          rowsPerPage: toolbar("rowsPerPage"),
          rowsPerPageUnit: toolbar("rowsPerPageUnit"),
          range: pagination("range", { from, to, total: result.data.total }),
        }}
      />
    </div>
  );
}
