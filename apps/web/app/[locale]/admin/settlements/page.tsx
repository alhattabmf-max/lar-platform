import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SUPPLIER_PAYOUT_OUTCOMES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminSettlements } from "@/lib/admin-data";
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
 * Payouts, as the operator who executed them sees them.
 *
 * THIS IS THE ONE SCREEN that shows `externalTransferReference` — the
 * bank's reference for the transfer. The operator needs it to reconcile
 * against a statement; it never travels to a supplier surface, and the
 * supplier's own settlement view does not carry the field at all.
 *
 * `ZERO_BALANCE` is an OUTCOME, not a failure: nothing was owed for that
 * shipment. It is toned neutral, never as an error.
 *
 * Nothing is summed. A payout is per SHIPMENT, so an order delivered to
 * three branches settles three times, and a total computed here would be
 * a second source of truth against the transfers that actually happened.
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
    namespace: "admin.settlements",
  });
  return { title: t("title") };
}

export default async function AdminSettlementsPage({
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
    namespace: "admin.settlements",
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
  const outcome = firstParam(query.outcome);
  const search = firstParam(query.search);

  return (
    <div className="flex flex-col gap-6">
      {/* STILL A HEADING, just not a second copy of the sidebar.
          Reading it off the screen was redundant; reading it with a
          screen reader is how somebody knows which page they landed
          on, because they cannot see which sidebar entry is lit. */}
      <h1 className="sr-only">{t("title")}</h1>

      <ListToolbar
        labels={{
          regionLabel: toolbar("regionLabel"),
          openLabel: filters("search"),
          searchLabel: filters("searchSupplier"),
          searchPlaceholder: toolbar("searchPlaceholder"),
          filtersPanelLabel: toolbar("filtersPanelLabel"),
          reset: toolbar("reset"),
        }}
        selects={[
          {
            name: "outcome",
            label: t("outcome"),
            options: [
              { value: "", label: filters("any") },
              // The SHARED vocabulary, not a local copy: the API's own
              // filter validates against this exact list.
              ...SUPPLIER_PAYOUT_OUTCOMES.map((value) => ({
                value,
                label: vocab(`payoutOutcome.${value}`),
              })),
            ],
          },
        ]}
      />

      <Suspense
        key={`${page}:${outcome ?? ""}:${search ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Settlements
          locale={appLocale}
          page={page}
          pageSize={pageSize}
          outcome={outcome}
          search={search}
        />
      </Suspense>
    </div>
  );
}

async function Settlements({
  locale,
  page,
  pageSize,
  outcome,
  search,
}: {
  locale: AppLocale;
  page: number;
  pageSize: number;
  outcome?: string;
  search?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.settlements" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const toolbar = await getTranslations({ locale, namespace: "admin.toolbar" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminSettlements({
    page,
    pageSize,
    outcome,
    search,
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

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-content-muted">{t("perShipmentNotice")}</p>

      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("executedAt")}</TH>
              <TH>{t("supplier")}</TH>
              <TH>{t("netAmount")}</TH>
              <TH>{t("outcome")}</TH>
              <TH>{t("transferReference")}</TH>
              <TH>{t("order")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((settlement) => (
              <TR key={settlement.id}>
                <TD>
                  <time dateTime={settlement.executedAt}>
                    {formatDate(settlement.executedAt, locale)}
                  </time>
                </TD>
                <TD>{settlement.supplierLegalName}</TD>
                <TD>
                  <Money
                    amount={settlement.netAmount}
                    currency={settlement.currency}
                    locale={locale}
                    fallback={<span className="text-content-muted">—</span>}
                  />
                </TD>
                <TD>
                  <StatusBadge
                    label={vocab(`payoutOutcome.${settlement.outcome}`)}
                    tone={
                      settlement.outcome === "EXECUTED" ? "done" : "neutral"
                    }
                  />
                </TD>
                {/* A ZERO_BALANCE payout has no transfer and therefore
                    no reference — an em dash, not an empty cell that
                    reads like missing data. */}
                <TD className="break-all font-mono text-xs">
                  {settlement.externalTransferReference ?? "—"}
                </TD>
                <TD>
                  <Link
                    href={`/${locale}/admin/orders/${settlement.masterOrderId}`}
                    className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                  >
                    {t("openOrder")}
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
