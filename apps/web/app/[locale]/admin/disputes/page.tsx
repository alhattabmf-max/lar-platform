import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DISPUTE_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminDisputes } from "@/lib/admin-data";
import { formatDate, formatDateTime } from "@/lib/localized";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge, disputeTone } from "@/components/trader/status-badge";
import { AdminFilters } from "@/components/admin/admin-filters";
import {
  AdminPagination,
  adminPaginationLabels,
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * Every dispute, newest first.
 *
 * The buyer's own description is NOT in this table. A queue is scanned,
 * and free text written by a counterparty does not belong in a
 * scannable column — it is on the case file, where an operator has
 * opened one dispute on purpose.
 *
 * `supplierResponseDueAt` is shown on every row and toned when it has
 * passed, because a supplier who has not answered in time is the single
 * thing that decides whether this case is waiting on them or on us.
 */
const PAGE_SIZE = 25;

export default async function AdminDisputesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.disputes" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const status = firstParam(query.status);
  const basePath = `/${appLocale}/admin/disputes`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <AdminFilters
        action={basePath}
        selects={[
          {
            name: "status",
            label: t("status"),
            value: status,
            options: [
              { value: "", label: filters("any") },
              // All seven, including the four RESOLVED_* separately: which
              // outcome a case reached is the whole question, and
              // collapsing them into "resolved" would hide it.
              ...DISPUTE_STATUSES.map((value) => ({
                value,
                label: vocab(`disputeStatus.${value}`),
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
        <Disputes locale={appLocale} basePath={basePath} page={page} status={status} />
      </Suspense>
    </div>
  );
}

async function Disputes({
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
  const t = await getTranslations({ locale, namespace: "admin.disputes" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminDisputes({ page, pageSize: PAGE_SIZE, status });

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

  // ONE clock reading for the whole table. Calling `new Date()` per row
  // would compare rows against slightly different instants, so a
  // deadline falling exactly now could be shown as both overdue and not
  // within a single render.
  const now = Date.now();

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("openedAt")}</TH>
              <TH>{t("reason")}</TH>
              <TH>{t("status")}</TH>
              <TH>{t("responseDue")}</TH>
              <TH>{t("order")}</TH>
              <TH>{t("open")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((dispute) => {
              const overdue =
                dispute.status === "OPEN" &&
                new Date(dispute.supplierResponseDueAt).getTime() < now;

              return (
                <TR key={dispute.id}>
                  <TD>
                    <time dateTime={dispute.openedAt}>{formatDate(dispute.openedAt, locale)}</time>
                  </TD>
                  <TD>{vocab(`disputeReason.${dispute.reasonCode}`)}</TD>
                  <TD>
                    <StatusBadge
                      label={vocab(`disputeStatus.${dispute.status}`)}
                      tone={disputeTone(dispute.status)}
                    />
                  </TD>
                  <TD>
                    <div className="flex flex-col gap-1">
                      <time dateTime={dispute.supplierResponseDueAt}>
                        {formatDateTime(dispute.supplierResponseDueAt, locale)}
                      </time>
                      {/* Colour is never the only signal — the badge
                          says "overdue" in words too. */}
                      {overdue ? (
                        <StatusBadge label={t("overdue")} tone="attention" />
                      ) : null}
                    </div>
                  </TD>
                  <TD>
                    <Link
                      href={`/${locale}/admin/orders/${dispute.masterOrderId}`}
                      className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                    >
                      {t("openOrder")}
                    </Link>
                  </TD>
                  <TD>
                    <Link
                      href={`/${locale}/admin/disputes/${dispute.id}`}
                      className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                    >
                      {t("openCase")}
                    </Link>
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
