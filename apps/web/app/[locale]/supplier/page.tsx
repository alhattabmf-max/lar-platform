import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import {
  loadFinancialReadiness,
  loadSupplierDisputes,
  loadSupplierOrders,
  loadSupplierReplacements,
  loadSupplierSettlements,
  loadSupplierUnreadCount,
} from "@/lib/supplier-data";
import { formatDate } from "@/lib/localized";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

/**
 * The supplier's landing screen inside the portal.
 *
 * Every figure comes from a real endpoint. There are no invented KPIs,
 * no placeholder charts and no metric the API cannot answer — an
 * approximate number on a dashboard is worse than no number, because
 * someone will act on it.
 *
 * Each panel loads behind its own Suspense boundary and renders its own
 * error state. One failing read costs that panel, never the page.
 *
 * What needs attention is shown FIRST, and vanishes entirely when
 * nothing does: an empty "needs attention" card teaches people to stop
 * looking at it, which is the one thing it must never do.
 */
export default async function SupplierDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  // The layout already guards this segment; repeating it here means a
  // future refactor that moves the page cannot silently unguard it.
  const session = await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.dashboard" });
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
          <FulfilmentPanel locale={appLocale} />
        </Suspense>

        <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
          <SettlementsPanel locale={appLocale} />
        </Suspense>

        <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
          <NotificationsPanel locale={appLocale} />
        </Suspense>
      </div>

      <section className="flex flex-wrap gap-3">
        <ButtonLink href={`/${appLocale}/supplier/account`} variant="accentInteractive">
          {t("goToAccount")}
        </ButtonLink>
      </section>
    </div>
  );
}

/**
 * One thing the supplier has to do something about.
 *
 * `href` is present only where the screen for it exists. An item
 * pointing at an unbuilt page would be a 404 reached by following our
 * own dashboard, so the unbuilt ones state the required action in
 * words instead — which is the real next step either way; the screen
 * is only where it gets recorded.
 */
interface AttentionRow {
  key: "payout" | "preparation" | "disputes" | "replacements";
  count?: number;
  /** True when the count was taken from a capped page rather than the whole list. */
  partial?: boolean;
  href?: string;
}

/**
 * Everything waiting on this supplier, in one place.
 *
 * Four independent reads. A failure in one does NOT let the others
 * report "all clear" — an unchecked category is listed as unchecked,
 * because a false all-clear on a fulfilment deadline is worse than an
 * error message.
 *
 * The counts for disputes and replacements are taken from the first
 * page, which the API caps at 50. When more exist, the row says so
 * rather than presenting a capped number as a total.
 */
async function NeedsAttentionPanel({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.dashboard" });
  const states = await getTranslations({ locale, namespace: "states" });

  const [readiness, orders, disputes, replacements] = await Promise.all([
    loadFinancialReadiness(),
    loadSupplierOrders({ pageSize: 50 }),
    loadSupplierDisputes({ pageSize: 50 }),
    loadSupplierReplacements({ pageSize: 50 }),
  ]);

  const rows: AttentionRow[] = [];
  const unchecked: string[] = [];

  if (!readiness.ok) unchecked.push(t("needsAttention.categories.payout"));
  else if (!readiness.data.isReady) {
    rows.push({ key: "payout", href: `/${locale}/supplier/account` });
  }

  if (!orders.ok) unchecked.push(t("needsAttention.categories.preparation"));
  else {
    const overdue = orders.data.items.filter((order) => order.hasOverduePreparation).length;
    if (overdue > 0) {
      rows.push({
        key: "preparation",
        count: overdue,
        partial: orders.data.total > orders.data.items.length,
        href: `/${locale}/supplier/orders`,
      });
    }
  }

  if (!disputes.ok) unchecked.push(t("needsAttention.categories.disputes"));
  else {
    const awaiting = disputes.data.items.filter((d) => d.awaitingSupplierResponse).length;
    if (awaiting > 0) {
      rows.push({
        key: "disputes",
        count: awaiting,
        partial: disputes.data.total > disputes.data.items.length,
        href: `/${locale}/supplier/disputes`,
      });
    }
  }

  if (!replacements.ok) unchecked.push(t("needsAttention.categories.replacements"));
  else {
    const awaiting = replacements.data.items.filter((r) => r.awaitingSupplierAction).length;
    if (awaiting > 0) {
      rows.push({
        key: "replacements",
        count: awaiting,
        partial: replacements.data.total > replacements.data.items.length,
        href: `/${locale}/supplier/replacement-obligations`,
      });
    }
  }

  // Nothing waiting and nothing unchecked: the card does not render at
  // all. An empty "needs attention" panel trains people to ignore it.
  if (rows.length === 0 && unchecked.length === 0) return null;

  return (
    <Card ariaLabel={t("needsAttention.title")} className="border-warning">
      <CardHeader>
        <CardTitle>{t("needsAttention.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        <ul className="flex list-none flex-col gap-4">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-1">
              <p className="text-sm font-medium text-content">
                {t(`needsAttention.${row.key}.label`, { count: row.count ?? 0 })}
              </p>
              <p className="text-sm text-content-muted">
                {t(`needsAttention.${row.key}.action`)}
              </p>
              {row.partial ? (
                <p className="text-xs text-content-muted">{t("needsAttention.countedFromRecent")}</p>
              ) : null}
              {row.href ? (
                <Link
                  href={row.href}
                  className="inline-flex min-h-11 items-center text-sm text-secondary hover:opacity-90"
                >
                  {t(`needsAttention.${row.key}.link`)}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>

        {unchecked.length > 0 ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            {/* The separator is translated too: a comma is not the same
                character in both locales, and joining with a literal one
                puts an Arabic comma into the English page. */}
            {t("needsAttention.unchecked", { items: unchecked.join(t("listSeparator")) })}{" "}
            {states("errorDescription")}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * Fulfilment at a glance.
 *
 * `total` is the API's own count of the supplier's orders. The two
 * per-state figures are summed over the page that was read, so the
 * panel says which set they describe rather than implying they cover
 * every order ever placed.
 */
async function FulfilmentPanel({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.dashboard" });
  const states = await getTranslations({ locale, namespace: "states" });

  const orders = await loadSupplierOrders({ pageSize: 50 });

  return (
    <Card ariaLabel={t("fulfilment.title")}>
      <CardHeader>
        <CardTitle>{t("fulfilment.title")}</CardTitle>
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
          <EmptyState
            title={t("fulfilment.emptyTitle")}
            description={t("fulfilment.emptyDescription")}
          />
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            <Figure label={t("fulfilment.totalOrders")} value={String(orders.data.total)} />
            <Figure
              label={t("fulfilment.awaitingPreparation")}
              value={String(
                orders.data.items.reduce((sum, order) => sum + order.awaitingPreparationCount, 0)
              )}
            />
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The most recent payout.
 *
 * One settlement, not a running total. Nothing on this screen adds
 * money: every amount arrives as a fixed-scale decimal string and is
 * formatted at the edge of rendering, and a client-side sum would
 * eventually disagree with the transfers that actually happened.
 *
 * `ZERO_BALANCE` is a real outcome, not a failure — nothing was owed
 * for that allocation — so it is labelled as its own outcome rather
 * than coloured like an error.
 */
async function SettlementsPanel({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.dashboard" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });
  const states = await getTranslations({ locale, namespace: "states" });

  const settlements = await loadSupplierSettlements({ pageSize: 1 });

  const latest = settlements.ok ? settlements.data.items[0] : undefined;
  const amount = latest ? formatMoney(latest.netAmount, latest.currency, locale) : null;
  const executed = latest ? formatDate(latest.executedAt, locale) : null;

  return (
    <Card ariaLabel={t("settlements.title")}>
      <CardHeader>
        <CardTitle>{t("settlements.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {!settlements.ok ? (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestId={settlements.error.requestId}
            requestIdLabel={states("requestIdLabel")}
          />
        ) : !latest ? (
          <EmptyState
            title={t("settlements.emptyTitle")}
            description={t("settlements.emptyDescription")}
          />
        ) : (
          <dl className="grid gap-3">
            {/* Null rather than "0.00" when the amount is not a decimal
                string the API should have sent: a zero is a claim about
                what someone was paid. */}
            {amount ? <Figure label={t("settlements.latestAmount")} value={amount} /> : null}
            <Figure
              label={t("settlements.outcome")}
              value={status(`payoutOutcome.${latest.outcome}`)}
            />
            {executed ? <Figure label={t("settlements.executedAt")} value={executed} /> : null}
            <Figure label={t("settlements.total")} value={String(settlements.data.total)} />
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

async function NotificationsPanel({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.dashboard" });
  const states = await getTranslations({ locale, namespace: "states" });

  const unread = await loadSupplierUnreadCount();

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

/** A labelled figure inside a panel's definition list. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-content-muted">{label}</dt>
      <dd className="text-sm font-medium text-content">{value}</dd>
    </div>
  );
}
