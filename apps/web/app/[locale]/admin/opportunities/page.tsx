import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SUPPLIER_OPPORTUNITY_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminOpportunities } from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { formatMoney, formatQuantity } from "@/lib/money";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { AdminFilters } from "@/components/admin/admin-filters";
import {
  AdminPagination,
  adminPaginationLabels,
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * Every opportunity, for monitoring.
 *
 * MONITOR-ONLY. There is no create and no edit anywhere in the admin
 * service — price, target quantity, share fields and every snapshot are
 * structurally unreachable from here, not merely blocked by a check.
 * The three actions that exist (pause, resume, cancel) live on the
 * detail page, where the operator has opened one listing on purpose.
 *
 * The status filter offers all eight values from the domain's own
 * transition table, so it cannot drift from what the lifecycle actually
 * produces.
 */
const PAGE_SIZE = 25;

export default async function AdminOpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.opportunities" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const status = firstParam(query.status);
  const basePath = `/${appLocale}/admin/opportunities`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content-muted">
        {t("monitorOnlyNotice")}
      </p>

      <AdminFilters
        action={basePath}
        selects={[
          {
            name: "status",
            label: t("status"),
            value: status,
            options: [
              { value: "", label: filters("any") },
              // The same eight values the domain's transition table
              // uses, declared once in the contracts package as the wire
              // vocabulary. The web app does not depend on @platform/domain.
              ...SUPPLIER_OPPORTUNITY_STATUSES.map((value) => ({
                value,
                label: vocab(`opportunityStatus.${value}`),
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
        key={`${page}:${status ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Opportunities locale={appLocale} basePath={basePath} page={page} status={status} />
      </Suspense>
    </div>
  );
}

async function Opportunities({
  locale,
  basePath,
  page,
  status,
}: {
  locale: AppLocale;
  basePath: string;
  page: number;
  status?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.opportunities" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminOpportunities({ page, pageSize: PAGE_SIZE, status });

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

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("createdAt")}</TH>
              <TH>{t("statusColumn")}</TH>
              <TH>{t("unitPrice")}</TH>
              <TH>{t("funding")}</TH>
              <TH>{t("window")}</TH>
              <TH>{t("open")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((opportunity) => (
              <TR key={opportunity.id}>
                <TD>
                  <time dateTime={opportunity.createdAt}>
                    {formatDate(opportunity.createdAt, locale)}
                  </time>
                </TD>
                <TD>
                  <StatusBadge
                    label={vocab(`opportunityStatus.${opportunity.status}`)}
                    tone={
                      opportunity.status === "FUNDED"
                        ? "done"
                        : opportunity.status === "ACTION_REQUIRED" ||
                            opportunity.status === "PAUSED"
                          ? "attention"
                          : "neutral"
                    }
                  />
                </TD>
                <TD>
                  {formatMoney(opportunity.unitPriceAmount, opportunity.currency, locale) ?? "—"}
                </TD>
                {/* Funded of target, as the two figures the server sent.
                    No percentage is computed here — a share of a
                    campaign is money-adjacent, and a rounded client-side
                    ratio is a second number nobody can reconcile. */}
                <TD>
                  {t("fundedOfTarget", {
                    funded: formatQuantity(opportunity.fundedQuantity, locale),
                    target: formatQuantity(opportunity.targetQuantity, locale),
                  })}
                </TD>
                <TD>
                  <span className="flex flex-col gap-1 text-xs">
                    <time dateTime={opportunity.startAt}>
                      {formatDate(opportunity.startAt, locale)}
                    </time>
                    <time dateTime={opportunity.endAt}>
                      {formatDate(opportunity.endAt, locale)}
                    </time>
                  </span>
                </TD>
                <TD>
                  <Link
                    href={`/${locale}/admin/opportunities/${opportunity.id}`}
                    className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                  >
                    {t("openDetail")}
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <AdminPagination
        basePath={basePath}
        page={result.data.page}
        pageSize={result.data.pageSize}
        total={result.data.total}
        query={{ status }}
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
