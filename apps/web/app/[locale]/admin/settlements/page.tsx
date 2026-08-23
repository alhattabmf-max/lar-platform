import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SUPPLIER_PAYOUT_OUTCOMES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminSettlements } from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { formatMoney } from "@/lib/money";
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
const PAGE_SIZE = 25;

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

  const t = await getTranslations({ locale: appLocale, namespace: "admin.settlements" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const outcome = firstParam(query.outcome);
  const search = firstParam(query.search);
  const basePath = `/${appLocale}/admin/settlements`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <AdminFilters
        action={basePath}
        search={{ name: "search", label: filters("searchSupplier"), value: search }}
        selects={[
          {
            name: "outcome",
            label: t("outcome"),
            value: outcome,
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
        labels={{
          regionLabel: filters("regionLabel"),
          apply: filters("apply"),
          clear: filters("clear"),
        }}
      />

      <Suspense
        key={`${page}:${outcome ?? ""}:${search ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Settlements
          locale={appLocale}
          basePath={basePath}
          page={page}
          outcome={outcome}
          search={search}
        />
      </Suspense>
    </div>
  );
}

async function Settlements({
  locale,
  basePath,
  page,
  outcome,
  search,
}: {
  locale: AppLocale;
  basePath: string;
  page: number;
  outcome?: string;
  search?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.settlements" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminSettlements({ page, pageSize: PAGE_SIZE, outcome, search });

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
                <TD>{formatMoney(settlement.netAmount, settlement.currency, locale) ?? "—"}</TD>
                <TD>
                  <StatusBadge
                    label={vocab(`payoutOutcome.${settlement.outcome}`)}
                    tone={settlement.outcome === "EXECUTED" ? "done" : "neutral"}
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
                    className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                  >
                    {t("openOrder")}
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
        query={{ outcome, search }}
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
