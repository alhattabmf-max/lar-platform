import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { OrderSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadTraderOrders } from "@/lib/trader-data";
import { localized, formatDate } from "@/lib/localized";
import { formatMoney, formatQuantity } from "@/lib/money";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/trader/status-badge";
import { TraderPagination, parsePage } from "@/components/trader/trader-pagination";

/**
 * The trader's orders.
 *
 * WHAT NEEDS ATTENTION COMES FIRST. An order with an overdue
 * preparation is the only thing on this screen a trader may have to
 * chase, so those are lifted to their own section above the rest
 * rather than left to be spotted among twenty rows.
 *
 * `hasOverduePreparation` is computed server-side, as are
 * `allocationCount` and `deliveredAllocationCount` — which is what
 * makes a list of twenty orders one request rather than twenty-one.
 * Nothing here opens an order to work out its progress.
 *
 * The lift is a REORDER within the page the API returned, not a filter
 * across all of them: it moves rows the reader can already see, so no
 * count changes and nothing is hidden.
 */
export default async function TraderOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const page = parsePage((await searchParams).page);

  const t = await getTranslations({ locale: appLocale, namespace: "trader.orders" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const pagination = await getTranslations({ locale: appLocale, namespace: "pagination" });

  const result = await loadTraderOrders({ page });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      {!result.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <ButtonLink href={`/${appLocale}/trader/opportunities`} variant="secondary" size="sm">
              {t("browseOpportunities")}
            </ButtonLink>
          }
        />
      ) : (
        <OrderList locale={appLocale} page={page} data={result.data} />
      )}

      {result.ok ? (
        <TraderPagination
          basePath={`/${appLocale}/trader/orders`}
          page={result.data.page}
          pageSize={result.data.pageSize}
          total={result.data.total}
          labels={{
            navLabel: pagination("navLabel"),
            previous: pagination("previous"),
            next: pagination("next"),
            status: pagination("status", {
              page: result.data.page,
              lastPage: Math.max(1, Math.ceil(result.data.total / result.data.pageSize)),
            }),
          }}
        />
      ) : null}
    </div>
  );
}

async function OrderList({
  locale,
  page,
  data,
}: {
  locale: AppLocale;
  page: number;
  data: { items: OrderSummary[]; total: number };
}) {
  const t = await getTranslations({ locale, namespace: "trader.orders" });

  const needsAttention = data.items.filter((order) => order.hasOverduePreparation);
  const rest = data.items.filter((order) => !order.hasOverduePreparation);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-content-muted">{t("resultCount", { count: data.total })}</p>

      {needsAttention.length > 0 ? (
        <section aria-label={t("needsAttention")} className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-warning-text">{t("needsAttention")}</h2>
          <p className="text-sm text-content-muted">{t("needsAttentionDescription")}</p>
          <ul className="flex list-none flex-col gap-3">
            {needsAttention.map((order) => (
              <li key={order.id}>
                <OrderRow order={order} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label={t("allOrders")} className="flex flex-col gap-3">
        {needsAttention.length > 0 && rest.length > 0 ? (
          <h2 className="text-base font-semibold text-content">{t("allOrders")}</h2>
        ) : null}
        <ul className="flex list-none flex-col gap-3">
          {rest.map((order) => (
            <li key={order.id}>
              <OrderRow order={order} locale={locale} />
            </li>
          ))}
        </ul>
      </section>

      {/* The page number is echoed so a reader who followed a link
          knows where they are, not only from the pager below. */}
      <span className="sr-only">{t("currentPage", { page })}</span>
    </div>
  );
}

async function OrderRow({ order, locale }: { order: OrderSummary; locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.orders" });
  const statuses = await getTranslations({ locale, namespace: "trader.status" });

  const name = localized(locale, order.productNameAr, order.productNameEn);
  const total = formatMoney(order.totalAmount, order.currency, locale);
  const paid = formatDate(order.paidAt, locale);

  return (
    <article
      className={`flex flex-col gap-2 rounded-lg border p-4 ${
        order.hasOverduePreparation ? "border-warning bg-warning-surface" : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-base font-semibold text-content">
          <Link
            href={`/${locale}/trader/orders/${order.id}`}
            className="hover:text-secondary focus-visible:underline"
          >
            {name}
          </Link>
        </h3>
        <StatusBadge
          label={statuses(`order.${order.status}`)}
          tone={order.status === "FULFILLED" ? "done" : "neutral"}
        />
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-content-muted">{t("total")}:</dt>
          <dd className="text-content">
            {total ?? <span className="text-content-muted">{t("amountUnavailable")}</span>}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-content-muted">{t("progress")}:</dt>
          <dd className="text-content">
            {t("deliveredOf", {
              delivered: formatQuantity(order.deliveredAllocationCount, locale),
              total: formatQuantity(order.allocationCount, locale),
            })}
          </dd>
        </div>
        {paid ? (
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("paidAt")}:</dt>
            <dd className="text-content">
              <time dateTime={order.paidAt}>{paid}</time>
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Says what is wrong in words. A coloured border alone is not a
          message, and is invisible to anyone who cannot see it. */}
      {order.hasOverduePreparation ? (
        <p className="text-sm font-medium text-warning-text">{t("overdueNotice")}</p>
      ) : null}
    </article>
  );
}
