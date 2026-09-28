import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { REFUND_OBLIGATION_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminRefunds } from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { Money } from "@/components/ui/money";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ListToolbar } from "@/components/admin/list-toolbar";
import {
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";
import { DataTablePagination } from "@/components/admin/data-table-pagination";
import { parsePageSize } from "@/lib/admin-list-query";

/**
 * Money owed back to buyers.
 *
 * NOTHING ON THIS PAGE IS SUMMED. Every amount is a decimal string
 * formatted at the edge of rendering, and a client-side total would be a
 * second source of truth that eventually disagrees with the transfers
 * that actually happened.
 *
 * `attemptCount` is on the row because it is the difference between an
 * obligation nobody has touched and one that has failed four times —
 * two states that look identical if you only read the status.
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
    namespace: "admin.refunds",
  });
  return { title: t("title") };
}

export default async function AdminRefundsPage({
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
    namespace: "admin.refunds",
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
              ...REFUND_OBLIGATION_STATUSES.map((value) => ({
                value,
                label: vocab(`refundStatus.${value}`),
              })),
            ],
          },
        ]}
      />

      <Suspense
        key={`${page}:${status ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Refunds
          locale={appLocale}
          page={page}
          pageSize={pageSize}
          status={status}
        />
      </Suspense>
    </div>
  );
}

async function Refunds({
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
  const t = await getTranslations({ locale, namespace: "admin.refunds" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const toolbar = await getTranslations({ locale, namespace: "admin.toolbar" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminRefunds({ page, pageSize, status });

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

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("createdAt")}</TH>
              <TH>{t("amount")}</TH>
              <TH>{t("status")}</TH>
              <TH>{t("source")}</TH>
              <TH>{t("reason")}</TH>
              <TH>{t("attempts")}</TH>
              <TH>{t("open")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((refund) => (
              <TR key={refund.id}>
                <TD>
                  <time dateTime={refund.createdAt}>
                    {formatDate(refund.createdAt, locale)}
                  </time>
                </TD>
                {/* A malformed amount renders as an em dash with the
                    status still visible, never as "NaN" and never as
                    "0.00" — a zero is a claim about money. */}
                <TD>
                  <Money amount={refund.amount} currency={refund.currency} locale={locale} fallback={<span className="text-content-muted">—</span>} />
                </TD>
                <TD>
                  <StatusBadge
                    label={vocab(`refundStatus.${refund.status}`)}
                    tone={
                      refund.status === "COMPLETED"
                        ? "done"
                        : refund.status === "FAILED"
                          ? "attention"
                          : "neutral"
                    }
                  />
                </TD>
                <TD>{vocab(`refundSource.${refund.source}`)}</TD>
                <TD>{vocab(`refundReason.${refund.reasonCode}`)}</TD>
                <TD>{refund.attemptCount}</TD>
                <TD>
                  <Link
                    href={`/${locale}/admin/refunds/${refund.id}`}
                    className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                  >
                    {t("openDetail")}
                  </Link>
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
