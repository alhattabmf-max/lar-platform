import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import {
  ADMIN_ACCOUNT_TYPES,
  COMPANY_VERIFICATION_STATUSES_ADMIN,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminCompanies } from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { AdminFilters } from "@/components/admin/admin-filters";
import { AdminAction } from "@/components/admin/admin-action";
import {
  AdminPagination,
  adminPaginationLabels,
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * Every company on the platform, and the supplier verification queue.
 *
 * ONE screen rather than two. "Suppliers awaiting verification" is this
 * list filtered to `PENDING_VERIFICATION` — the dashboard links straight
 * to that filter — so the queue and the directory cannot disagree about
 * what is waiting, and an operator who finishes the queue is already
 * looking at the place to search for whatever they were asked about
 * next.
 *
 * Approve and reject appear only on a PENDING supplier row. Rejection
 * requires a written reason: it is delivered to the company as the
 * explanation for why they cannot trade, and "rejected" with no cause is
 * an answer nobody can act on.
 */
const PAGE_SIZE = 25;

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

  const t = await getTranslations({ locale: appLocale, namespace: "admin.companies" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const search = firstParam(query.search);
  const accountType = firstParam(query.accountType);
  const verificationStatus = firstParam(query.verificationStatus);

  const basePath = `/${appLocale}/admin/companies`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <AdminFilters
        action={basePath}
        search={{ name: "search", label: filters("search"), value: search }}
        selects={[
          {
            name: "accountType",
            label: t("accountType"),
            value: accountType,
            options: [
              { value: "", label: filters("any") },
              ...ADMIN_ACCOUNT_TYPES.map((value) => ({
                value,
                label: vocab(`accountType.${value}`),
              })),
            ],
          },
          {
            name: "verificationStatus",
            label: t("verificationStatus"),
            value: verificationStatus,
            options: [
              { value: "", label: filters("any") },
              ...COMPANY_VERIFICATION_STATUSES_ADMIN.map((value) => ({
                value,
                label: vocab(`companyVerification.${value}`),
              })),
            ],
          },
        ]}
        labels={{
          regionLabel: filters("regionLabel"),
          apply: filters("apply"),
          clear: filters("clear"),
        }}
      />

      <Suspense
        // Keyed on the query so changing a filter shows the loading
        // state again instead of leaving the previous page's rows on
        // screen while the new ones are fetched — stale rows under a new
        // filter read as results.
        key={`${page}:${search ?? ""}:${accountType ?? ""}:${verificationStatus ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Companies
          locale={appLocale}
          basePath={basePath}
          page={page}
          search={search}
          accountType={accountType}
          verificationStatus={verificationStatus}
        />
      </Suspense>
    </div>
  );
}

async function Companies({
  locale,
  basePath,
  page,
  search,
  accountType,
  verificationStatus,
}: {
  locale: AppLocale;
  basePath: string;
  page: number;
  search?: string;
  accountType?: string;
  verificationStatus?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.companies" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminCompanies({
    page,
    pageSize: PAGE_SIZE,
    search,
    accountType,
    verificationStatus,
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
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  const actionLabels = {
    confirm: actions("confirm"),
    cancel: actions("cancel"),
    working: actions("working"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Wide tables scroll inside their own container, so the page body
          never scrolls sideways at 360px. */}
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("legalName")}</TH>
              <TH>{t("crNumber")}</TH>
              <TH>{t("accountType")}</TH>
              <TH>{t("verificationStatus")}</TH>
              <TH>{t("ownerEmail")}</TH>
              <TH>{t("userCount")}</TH>
              <TH>{t("createdAt")}</TH>
              <TH>{t("actionsColumn")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((company) => {
              const pendingSupplier =
                company.accountType === "SUPPLIER" &&
                company.verificationStatus === "PENDING_VERIFICATION";

              return (
                <TR key={company.id}>
                  <TD>{company.legalName}</TD>
                  <TD className="font-mono text-xs">{company.crNumber}</TD>
                  <TD>{vocab(`accountType.${company.accountType}`)}</TD>
                  <TD>
                    <StatusBadge
                      label={vocab(`companyVerification.${company.verificationStatus}`)}
                      tone={
                        company.verificationStatus === "VERIFIED"
                          ? "done"
                          : company.verificationStatus === "PENDING_VERIFICATION"
                            ? "attention"
                            : "neutral"
                      }
                    />
                  </TD>
                  {/* An address with no owner recorded shows an em dash,
                      never a fabricated placeholder. */}
                  <TD className="break-all">{company.ownerEmail ?? "—"}</TD>
                  <TD>{company.userCount}</TD>
                  <TD>
                    <time dateTime={company.createdAt}>
                      {formatDate(company.createdAt, locale)}
                    </time>
                  </TD>
                  <TD>
                    {pendingSupplier ? (
                      <div className="flex flex-col gap-2">
                        <AdminAction
                          path={`/admin/operations/suppliers/${company.id}/approve`}
                          labels={{
                            ...actionLabels,
                            action: t("approve"),
                            prompt: t("approvePrompt", { name: company.legalName }),
                          }}
                        />
                        <AdminAction
                          path={`/admin/operations/suppliers/${company.id}/reject`}
                          variant="danger"
                          reason={{
                            field: "reason",
                            label: t("rejectReason"),
                            minLength: 5,
                            maxLength: 1000,
                            hint: t("rejectReasonHint"),
                          }}
                          labels={{
                            ...actionLabels,
                            action: t("reject"),
                            prompt: t("rejectPrompt", { name: company.legalName }),
                          }}
                        />
                      </div>
                    ) : (
                      // No action rather than a disabled one: a control
                      // that can never do anything on this row is noise.
                      <span className="text-sm text-content-muted">—</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      <AdminPagination
        basePath={basePath}
        page={result.data.page}
        pageSize={result.data.pageSize}
        total={result.data.total}
        query={{ search, accountType, verificationStatus }}
        labels={adminPaginationLabels(
          pagination,
          result.data.page,
          result.data.pageSize,
          result.data.total
        )}
      />
    </div>
  );
}
