import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SupplierOrderSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierOrders } from "@/lib/supplier-data";
import { localized, formatDate } from "@/lib/localized";
import { formatMoney, formatQuantity } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * The supplier's orders.
 *
 * OVERDUE FIRST. `hasOverduePreparation` is computed server-side, so
 * sorting by it costs nothing extra — and a shipment past its preparation
 * deadline is the only thing on this page someone has to chase today.
 *
 * The trader is nowhere on this screen. `SupplierOrderSummary` carries no
 * buyer identity at all — the projection does not select one.
 *
 * Every amount is a decimal string formatted at the edge of rendering.
 * Nothing here sums or derives money.
 */
export default async function SupplierOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.orders" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <Orders locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Orders({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.orders" });
  const states = await getTranslations({ locale, namespace: "states" });

  const orders = await loadSupplierOrders({ pageSize: 50 });

  if (!orders.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={orders.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (orders.data.total === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  const overdue = orders.data.items.filter((order) => order.hasOverduePreparation);
  const awaiting = orders.data.items.filter(
    (order) => !order.hasOverduePreparation && order.awaitingPreparationCount > 0
  );
  const rest = orders.data.items.filter(
    (order) => !order.hasOverduePreparation && order.awaitingPreparationCount === 0
  );

  return (
    <div className="flex flex-col gap-6">
      {overdue.length > 0 ? (
        <Card ariaLabel={t("overdue.title")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("overdue.title")}</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-content-muted">{t("overdue.description")}</p>
            <OrderList locale={locale} orders={overdue} />
          </CardBody>
        </Card>
      ) : null}

      {awaiting.length > 0 ? (
        <section aria-label={t("awaiting.title")} className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-content">{t("awaiting.title")}</h2>
          <OrderList locale={locale} orders={awaiting} />
        </section>
      ) : null}

      <section aria-label={t("allTitle")} className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-content">{t("allTitle")}</h2>
        {rest.length === 0 ? (
          <p className="text-sm text-content-muted">{t("allHandled")}</p>
        ) : (
          <OrderList locale={locale} orders={rest} />
        )}
      </section>

      {orders.data.total > orders.data.items.length ? (
        <p className="text-sm text-content-muted">{t("showingRecent")}</p>
      ) : null}
    </div>
  );
}

async function OrderList({
  locale,
  orders,
}: {
  locale: AppLocale;
  orders: readonly SupplierOrderSummary[];
}) {
  const t = await getTranslations({ locale, namespace: "supplier.orders" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });

  return (
    <ul className="grid list-none gap-3 sm:grid-cols-2">
      {orders.map((order) => {
        const name = localized(locale, order.productNameAr, order.productNameEn);
        const payable = formatMoney(order.supplierPayableAmount, order.currency, locale);
        const paid = formatDate(order.paidAt, locale);

        return (
          <li key={order.id}>
            <Card>
              <CardBody>
                <div className="flex flex-col gap-2">
                  <Link
                    href={`/${locale}/supplier/orders/${order.id}`}
                    className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                  >
                    {name}
                  </Link>

                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={status(`order.${order.status}`)}
                      tone={order.status === "FULFILLED" ? "done" : "neutral"}
                    />
                    {order.hasOverduePreparation ? (
                      <StatusBadge label={t("overdueBadge")} tone="attention" />
                    ) : null}
                  </span>

                  <dl className="grid gap-1 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("shipments")}</dt>
                      {/* Three counts printed side by side — never a
                          percentage this page computed. */}
                      <dd className="text-content">
                        {t("shipmentProgress", {
                          delivered: formatQuantity(order.deliveredAllocationCount, locale),
                          total: formatQuantity(order.allocationCount, locale),
                        })}
                      </dd>
                    </div>
                    {order.awaitingPreparationCount > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("awaitingPreparation")}</dt>
                        <dd className="text-content">
                          {formatQuantity(order.awaitingPreparationCount, locale)}
                        </dd>
                      </div>
                    ) : null}
                    {payable ? (
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("payable")}</dt>
                        <dd className="text-content">{payable}</dd>
                      </div>
                    ) : null}
                    {paid ? (
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("paidAt")}</dt>
                        <dd className="text-content">
                          <time dateTime={order.paidAt}>{paid}</time>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
