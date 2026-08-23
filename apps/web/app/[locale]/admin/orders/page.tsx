import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MASTER_ORDER_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminOrders } from "@/lib/admin-data";
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
 * Every order, newest first.
 *
 * BOTH SIDES OF THE MONEY are here — what the buyer paid and what the
 * platform owes the supplier — and this is the only surface where they
 * appear together. The trader's own view never carries the payable, and
 * the supplier's never carries the buyer.
 *
 * There are exactly TWO statuses. A `MasterOrder` row is created by the
 * payment that paid for it, so there is no pending or cancelled order to
 * filter for, and the filter offers only what exists.
 *
 * No currency column: `MasterOrder` has no currency field. The platform
 * settles in one currency and the row does not record one, so the
 * formatter is given the platform's currency rather than a value
 * invented per row.
 */
const PAGE_SIZE = 25;

export default async function AdminOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.orders" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const status = firstParam(query.status);
  const basePath = `/${appLocale}/admin/orders`;

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
              ...MASTER_ORDER_STATUSES.map((value) => ({
                value,
                label: vocab(`orderStatus.${value}`),
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
        <Orders locale={appLocale} basePath={basePath} page={page} status={status} />
      </Suspense>
    </div>
  );
}

async function Orders({
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
  const t = await getTranslations({ locale, namespace: "admin.orders" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });
  const money = await getTranslations({ locale, namespace: "admin.money" });

  const result = await loadAdminOrders({ page, pageSize: PAGE_SIZE, status });

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

  // The platform's settlement currency, from the message catalogue
  // rather than hardcoded in this file — the row itself does not record
  // one, and a literal here would be a claim the data does not make.
  const currency = money("platformCurrency");

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("paidAt")}</TH>
              <TH>{t("trader")}</TH>
              <TH>{t("supplier")}</TH>
              <TH>{t("totalAmount")}</TH>
              <TH>{t("supplierPayable")}</TH>
              <TH>{t("status")}</TH>
              <TH>{t("shipments")}</TH>
              <TH>{t("open")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((order) => (
              <TR key={order.id}>
                <TD>
                  <time dateTime={order.paidAt}>{formatDate(order.paidAt, locale)}</time>
                </TD>
                <TD>{order.traderCompanyLegalName || "—"}</TD>
                <TD>{order.supplierCompanyLegalName}</TD>
                <TD>{formatMoney(order.totalAmount, currency, locale) ?? "—"}</TD>
                <TD>{formatMoney(order.supplierPayableAmount, currency, locale) ?? "—"}</TD>
                <TD>
                  <StatusBadge
                    label={vocab(`orderStatus.${order.status}`)}
                    tone={order.status === "FULFILLED" ? "done" : "neutral"}
                  />
                </TD>
                <TD>{order.allocationCount}</TD>
                <TD>
                  <Link
                    href={`/${locale}/admin/orders/${order.id}`}
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
