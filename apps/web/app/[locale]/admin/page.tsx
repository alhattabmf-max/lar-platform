import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import {
  Building2,
  CreditCard,
  Coins,
  RotateCcw,
  ShoppingCart,
  Target,
  UserCheck,
  Users,
} from "lucide-react";
import { DASHBOARD_PERIODS } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadDashboardOverview } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { Money } from "@/components/ui/money";
import { ErrorState } from "@/components/ui/states";
import { MetricCard, PeriodPicker } from "@/components/admin/dashboard-chrome";
import {
  CompanyGrowth,
  FinancialPerformance,
  NeedsAttention,
  OrderStatus,
} from "@/components/admin/dashboard-panels";

/**
 * The overview: what the platform took, what it owes, and what is stuck.
 *
 * ONE READ. The screen this replaces called six list endpoints and
 * counted their lengths — which made "eight suppliers waiting" a number
 * that changed with the page size. Every figure here is a database
 * aggregate over one window.
 *
 * ONE SCREEN. Everything from the title to the last two panels is meant
 * to be visible at 1600×900 without scrolling, which is why the gaps,
 * the card padding and the plot heights are what they are. Below that
 * width the rows stack and the page scrolls normally; on a phone
 * nothing runs sideways.
 *
 * THE WINDOW IS IN THE URL, so it survives a reload, travels with the
 * links to the other two screens, and comes back with the Back button.
 *
 * NOTHING IS INVENTED. With no orders the figures are zeros and the
 * comparisons are em dashes; where a series has too little shape to
 * draw honestly the panel says so and shows the total instead. There is
 * no placeholder anywhere on this page.
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
  const appLocale = locale as AppLocale;
  const [t, nav] = await Promise.all([
    getTranslations({ locale: appLocale, namespace: "admin.overview" }),
    getTranslations({ locale: appLocale, namespace: "admin.nav" }),
  ]);

  // COMPOSED HERE, not by the layout's template. Next applies a title
  // template to CHILD segments only — never to the segment that defines
  // it — so this page, which lives at the layout's own path, would come
  // out as a bare «نظرة عامة» while every page beneath it got the
  // suffix. Written out, the whole portal reads the same way.
  return { title: `${t("title")} | ${nav("portalName")}` };
}

export default async function AdminOverviewPage({
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
    namespace: "admin.overview",
  });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });
  const money = await getTranslations({
    locale: appLocale,
    namespace: "admin.money",
  });
  const currency = money("platformCurrency");

  const raw = Array.isArray(query.period) ? query.period[0] : query.period;
  const period = (DASHBOARD_PERIODS as readonly string[]).includes(raw ?? "")
    ? (raw as string)
    : "30d";

  const result = await loadDashboardOverview(period);

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

  const data = result.data;

  /**
   * A DECIMAL STRING, formatted once at the very edge of rendering.
   *
   * The em dash is for a value the API should not have sent, never for
   * a zero: `formatMoney` accepts "0.00" and returns a real amount, so
   * a period with no trade reads «0.00 ر.س» rather than a dash that
   * would mean "unknown".
   */
  // A ZERO IS STILL AN ANSWER. A period with no trade reads «0.00»
  // with the symbol, not a dash — the dash means "unknown".
  const amount = (value: string) => (
    <Money
      amount={value}
      currency={currency}
      locale={appLocale}
      fallback={<span className="text-content-muted">—</span>}
    />
  );

  const base = `/${appLocale}/admin`;
  const withPeriod = (path: string) =>
    `${base}${path}${path.includes("?") ? "&" : "?"}period=${period}`;

  const granularity = data.series.granularity;
  /** «الأسبوع 1», «الأسبوع 2» … numbered once and shared by both charts. */
  const bucketNames = data.series.paidOrders.map((_, index) =>
    t(`bucket.${granularity}`, { n: index + 1 }),
  );
  const units = { thousand: t("units.thousand"), million: t("units.million") };

  /**
   * The one place this page reads a warning into a figure.
   *
   * The supplier payable is NOT coloured by its own size — a larger
   * balance owed is the consequence of more trade, not a failure. What
   * makes it a problem is a settlement that is late, and that is a fact
   * the page already holds: the follow-up figures below carry it. So
   * the note turns amber only when there really are overdue
   * settlements, and never because a number looked large.
   */
  const overdueSettlements = data.attention.find(
    (row) => row.kind === "SETTLEMENT_OVERDUE",
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <PeriodPicker
          period={period}
          generatedAt={formatDateTime(data.generatedAt, appLocale) ?? "—"}
          labels={{
            label: t("periodLabel"),
            comparison: t("comparison"),
            lastUpdated: t("lastUpdated"),
            refresh: t("refresh"),
            options: Object.fromEntries(
              DASHBOARD_PERIODS.map((value) => [value, t(`period.${value}`)]),
            ),
          }}
        />
      </header>

      {/* THE FOUR FINANCIAL CARDS. */}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          testId="card-paid-orders"
          icon={<ShoppingCart className="size-5" />}
          label={t("paidOrders")}
          value={amount(data.financials.paidOrders.value)}
          delta={data.financials.paidOrders.changePercent}
          deltaIntent="more-is-good"
          note={t("paidOrderCount", { count: data.financials.paidOrderCount })}
          noteDivider
          accent="primary"
        />
        <MetricCard
          testId="card-revenue"
          icon={<Coins className="size-5" />}
          label={t("platformRevenue")}
          value={amount(data.financials.platformRevenue.value)}
          delta={data.financials.platformRevenue.changePercent}
          deltaIntent="more-is-good"
          note={
            data.financials.averageCommissionBasisPoints === null
              ? t("noCommission")
              : t("averageCommission", {
                  percent: (
                    data.financials.averageCommissionBasisPoints / 100
                  ).toFixed(1),
                })
          }
          noteDivider
          accent="accent"
        />
        <MetricCard
          testId="card-payable"
          icon={<Users className="size-5" />}
          label={t("supplierPayable")}
          value={amount(data.financials.supplierPayable.value)}
          delta={data.financials.supplierPayable.changePercent}
          // MONEY OWED IS NOT A VERDICT. See `overdueSettlements` above.
          deltaIntent="neutral"
          note={
            overdueSettlements
              ? t("settlementsOverdue", { count: overdueSettlements.count })
              : t("pendingSettlements", {
                  count: data.financials.pendingSettlements,
                })
          }
          noteTone={overdueSettlements ? "warning" : "muted"}
          noteDivider
          accent="primary"
        />
        <MetricCard
          testId="card-refunded"
          icon={<RotateCcw className="size-5" />}
          label={t("refunded")}
          value={amount(data.financials.refunded.value)}
          delta={data.financials.refunded.changePercent}
          // MORE REFUNDED IS NOT GOOD NEWS. Colouring this green because
          // the figure rose is the dashboard saying the opposite of what
          // happened, in the most confident way it has.
          deltaIntent="more-is-bad"
          note={
            data.financials.refundRatePercent === null
              ? t("noRefundRate")
              : t("refundRate", { percent: data.financials.refundRatePercent })
          }
          noteDivider
          accent="primary"
        />
      </div>

      {/* THE FOUR OPERATIONAL CARDS. */}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          testId="card-payment-rate"
          icon={<CreditCard className="size-5" />}
          label={t("paymentSuccess")}
          value={
            data.operations.paymentSuccessRate.value === null
              ? "—"
              : `${data.operations.paymentSuccessRate.value}%`
          }
          delta={rateChange(data.operations.paymentSuccessRate)}
          deltaIntent="more-is-good"
        />
        <MetricCard
          testId="card-opportunities"
          icon={<Target className="size-5" />}
          label={t("activeOpportunities")}
          value={String(data.operations.activeOpportunities.value)}
          // NO ARROW HERE, as the design has none: what an operator acts
          // on is how many close soon, not how the count moved.
          note={t("endingSoon", { count: data.operations.endingSoon })}
          noteTone="info"
        />
        <MetricCard
          testId="card-suppliers"
          icon={<UserCheck className="size-5" />}
          label={t("activeSuppliers")}
          value={String(data.operations.activeSuppliers.value)}
          delta={data.operations.activeSuppliers.changePercent}
          deltaIntent="more-is-good"
        />
        <MetricCard
          testId="card-buyers"
          icon={<Building2 className="size-5" />}
          label={t("activeBuyers")}
          value={String(data.operations.activeBuyers.value)}
          delta={data.operations.activeBuyers.changePercent}
          deltaIntent="more-is-good"
        />
      </div>

      <div className="grid min-w-0 items-stretch gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <FinancialPerformance
          series={data.series}
          locale={appLocale}
          totals={{
            paidOrders: {
              value: amount(data.financials.paidOrders.value),
              delta: data.financials.paidOrders.changePercent,
            },
            platformRevenue: {
              value: amount(data.financials.platformRevenue.value),
              delta: data.financials.platformRevenue.changePercent,
            },
          }}
          labels={{
            title: t("financialPerformance"),
            granularity: t(`granularity.${granularity}`),
            current: t("current"),
            comparison: t("comparison"),
            notEnoughData: t("notEnoughData"),
            units,
            paidOrders: t("paidOrders"),
            platformRevenue: t("platformRevenue"),
            bucketNames,
          }}
        />

        <CompanyGrowth
          points={data.growth}
          granularity={granularity}
          locale={appLocale}
          labels={{
            title: t("companyGrowth"),
            buyers: t("buyers"),
            suppliers: t("suppliers"),
            empty: t("growthEmpty"),
            units,
            bucketNames,
          }}
        />
      </div>

      <div className="grid min-w-0 items-stretch gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <OrderStatus
          counts={{
            completed: data.orders.completed,
            inFulfilment: data.orders.inFulfilment,
            troubled: data.orders.troubled,
          }}
          href={withPeriod("/orders")}
          labels={{
            title: t("orderStatus"),
            completed: t("stage.completed"),
            inFulfilment: t("stage.inFulfilment"),
            troubled: t("stage.troubled"),
            link: t("viewOrders"),
          }}
        />

        <NeedsAttention
          rows={data.attention}
          locale={appLocale}
          href={withPeriod("/follow-up")}
          labels={{
            title: t("needsAttention"),
            link: t("viewAllAlerts"),
            empty: t("nothingWaiting"),
            caseName: (row) => t(`case.${row.kind}`, { count: row.count }),
            priorityName: (priority) => t(`priority.${priority}`),
            age: (hours) => t("oldest", { hours }),
          }}
        />
      </div>
    </div>
  );
}

/**
 * How the payment success rate moved, as a percentage of itself.
 *
 * UNCHANGED ARITHMETIC, lifted out of the markup so the card reads as a
 * card. It is a relative change — 90% to 94.8% is "+5.3%", not "+4.8
 * points" — which is the definition already in place; this batch was
 * asked to correct the display, not the measure.
 *
 * Null whenever a percentage would lie: no previous value at all, or a
 * previous value of zero.
 */
function rateChange(rate: {
  value: number | null;
  previous: number | null;
}): number | null {
  if (rate.value === null || rate.previous === null || rate.previous === 0)
    return null;
  return Math.round(((rate.value - rate.previous) / rate.previous) * 1000) / 10;
}
