import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadTraderOrders, loadUnreadNotificationCount } from "@/lib/trader-data";
import { localized } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

/**
 * The trader's landing screen inside the portal.
 *
 * Every figure comes from a real endpoint. There are no invented KPIs,
 * no placeholder charts and no metric the API cannot answer — an
 * approximate number on a dashboard is worse than no number, because
 * someone will act on it.
 *
 * Each panel loads behind its own Suspense boundary and renders its own
 * error state. One failing read costs that panel, never the page.
 *
 * What needs attention is shown FIRST: an order with an overdue
 * preparation is the only thing here a trader may have to chase.
 */
export default async function TraderDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  // The layout already guards this group; repeating it here means a
  // future refactor that moves the page cannot silently unguard it.
  const session = await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.dashboard" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">
          {t("signedInAs", { company: session.company.legalName })}
        </p>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
        <NeedsAttentionPanel locale={appLocale} />
      </Suspense>

      <div className="grid gap-4 md:grid-cols-2">
        <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
          <OrdersPanel locale={appLocale} />
        </Suspense>

        <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
          <NotificationsPanel locale={appLocale} />
        </Suspense>
      </div>

      <section className="flex flex-wrap gap-3">
        <ButtonLink href={`/${appLocale}/trader/opportunities`} variant="accentInteractive">
          {t("browseOpportunities")}
        </ButtonLink>
        <ButtonLink href={`/${appLocale}/trader/orders`} variant="secondary">
          {t("viewOrders")}
        </ButtonLink>
        <ButtonLink href={`/${appLocale}/trader/account`} variant="ghost">
          {t("account")}
        </ButtonLink>
      </section>
    </div>
  );
}

/**
 * Orders whose preparation deadline has passed without shipping.
 *
 * `hasOverduePreparation` is computed server-side, so this panel needs
 * one request rather than one per order.
 */
async function NeedsAttentionPanel({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.dashboard" });
  const states = await getTranslations({ locale, namespace: "states" });

  const orders = await loadTraderOrders({ pageSize: 50 });
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

  const attention = orders.data.items.filter((order) => order.hasOverduePreparation);
  if (attention.length === 0) return null;

  return (
    <Card ariaLabel={t("needsAttention.title")} className="border-warning">
      <CardHeader>
        <CardTitle>{t("needsAttention.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-3 text-sm text-content-muted">{t("needsAttention.description")}</p>
        <ul className="flex list-none flex-col gap-2">
          {attention.map((order) => (
            <li key={order.id} className="text-sm">
              <Link
                href={`/${locale}/trader/orders/${order.id}`}
                className="text-secondary hover:opacity-90"
              >
                {localized(locale, order.productNameAr, order.productNameEn)}
              </Link>{" "}
              <span className="text-content-muted">
                {t("needsAttention.progress", {
                  delivered: order.deliveredAllocationCount,
                  total: order.allocationCount,
                })}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

async function OrdersPanel({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.dashboard" });
  const states = await getTranslations({ locale, namespace: "states" });

  const orders = await loadTraderOrders({ pageSize: 5 });

  return (
    <Card ariaLabel={t("orders.title")}>
      <CardHeader>
        <CardTitle>{t("orders.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {!orders.ok ? (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestId={orders.error.requestId}
            requestIdLabel={states("requestIdLabel")}
          />
        ) : orders.data.total === 0 ? (
          <EmptyState title={t("orders.emptyTitle")} description={t("orders.emptyDescription")} />
        ) : (
          <>
            <p className="mb-3 text-sm text-content-muted">
              {t("orders.total", { count: orders.data.total })}
            </p>
            <ul className="flex list-none flex-col gap-2">
              {orders.data.items.map((order) => (
                <li key={order.id} className="flex flex-wrap justify-between gap-2 text-sm">
                  <Link
                    href={`/${locale}/trader/orders/${order.id}`}
                    className="text-secondary hover:opacity-90"
                  >
                    {localized(locale, order.productNameAr, order.productNameEn)}
                  </Link>
                  <span className="text-content-muted">
                    {t("orders.delivered", {
                      delivered: order.deliveredAllocationCount,
                      total: order.allocationCount,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

async function NotificationsPanel({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.dashboard" });
  const states = await getTranslations({ locale, namespace: "states" });

  const unread = await loadUnreadNotificationCount();

  return (
    <Card ariaLabel={t("notifications.title")}>
      <CardHeader>
        <CardTitle>{t("notifications.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {!unread.ok ? (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestId={unread.error.requestId}
            requestIdLabel={states("requestIdLabel")}
          />
        ) : (
          <p className="text-sm text-content">
            {t("notifications.unread", { count: unread.data.unread })}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
