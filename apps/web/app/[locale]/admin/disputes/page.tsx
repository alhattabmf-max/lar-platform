import { Suspense } from "react";
import type { Metadata } from "next";
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
import { ListToolbar } from "@/components/admin/list-toolbar";
import {
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";
import { DataTablePagination } from "@/components/admin/data-table-pagination";
import { parsePageSize } from "@/lib/admin-list-query";

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
    namespace: "admin.disputes",
  });
  return { title: t("title") };
}

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

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.disputes",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });
  const toolbar = await getTranslations({
    locale: appLocale,
    namespace: "admin.toolbar",
  });
  const filters = await getTranslations({
    locale: appLocale,
    namespace: "admin.filters",
  });
  const vocab = await getTranslations({
    locale: appLocale,
    namespace: "admin.vocab",
  });

  const page = parseAdminPage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  const status = firstParam(query.status);

  return (
    <div className="flex flex-col gap-6">
      {/* STILL A HEADING, just not a second copy of the sidebar.
          Reading it off the screen was redundant; reading it with a
          screen reader is how somebody knows which page they landed
          on, because they cannot see which sidebar entry is lit. */}
      <h1 className="sr-only">{t("title")}</h1>

      <ListToolbar
        searchable={false}
        labels={{
          regionLabel: toolbar("regionLabel"),
          openLabel: filters("search"),
          searchLabel: filters("search"),
          searchPlaceholder: toolbar("searchPlaceholder"),
          filtersPanelLabel: toolbar("filtersPanelLabel"),
          reset: toolbar("reset"),
        }}
        selects={[
          {
            name: "status",
            label: t("status"),
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
      />

      <Suspense
        key={`${page}:${status ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Disputes
          locale={appLocale}
          page={page}
          pageSize={pageSize}
          status={status}
        />
      </Suspense>
    </div>
  );
}

async function Disputes({
  locale,
  page,
  pageSize,
  status,
}: {
  locale: AppLocale;
  page: number;
  pageSize: number;
  status?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.disputes" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const toolbar = await getTranslations({ locale, namespace: "admin.toolbar" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminDisputes({ page, pageSize, status });

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
                    <time dateTime={dispute.openedAt}>
                      {formatDate(dispute.openedAt, locale)}
                    </time>
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
                      className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                    >
                      {t("openOrder")}
                    </Link>
                  </TD>
                  <TD>
                    <Link
                      href={`/${locale}/admin/disputes/${dispute.id}`}
                      className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
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
          range: pagination("range", {
            from: (result.data.page - 1) * result.data.pageSize + 1,
            to: Math.min(
              result.data.page * result.data.pageSize,
              result.data.total,
            ),
            total: result.data.total,
          }),
        }}
      />
    </div>
  );
}
