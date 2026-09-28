import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import type {
  CompanyRequirement,
  DashboardPeriod,
  OrderAllocationStatus,
} from "@platform/types";
import {
  COMPANY_REQUIREMENTS,
  DASHBOARD_PERIODS,
  ORDER_ALLOCATION_STATUSES,
} from "@platform/types";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { CompletenessBanner } from "@/components/company/completeness-banner";
import { loadSupplierDashboard } from "@/lib/supplier-data";
import { formatDate, formatTime } from "@/lib/localized";
import { ErrorState } from "@/components/ui/states";
import { DashboardHeader } from "@/components/supplier/dashboard-header";
import { SupplierDashboardCards } from "@/components/supplier/dashboard-cards";
import { SalesChart } from "@/components/supplier/sales-chart";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.dashboard");

import {
  FulfilmentPanel,
  ListingsPanel,
  SettlementsPanel,
} from "@/components/supplier/dashboard-panels";

/**
 * The supplier's landing screen, built to the approved reference.
 *
 * ONE READ, NOT SIX. The page used to assemble itself from six list
 * endpoints and count the rows that came back — which answers "how
 * many are on the first page", never "how many are there". Every
 * figure now comes from `GET /supplier/dashboard/overview`, where each
 * one is a SUM or a COUNT the database performed.
 *
 * EVERY NUMBER IS THIS SUPPLIER'S OWN. There is no sample data, no
 * placeholder series and no metric the API cannot answer. Where a
 * figure genuinely does not exist — a first month with no predecessor,
 * a company that has never been paid — the screen says so rather than
 * showing a plausible number somebody would act on.
 *
 * THE PERIOD IS A URL PARAMETER, so a chosen window survives a reload
 * and can be linked to; the server reads it and the whole page follows.
 */
export default async function SupplierDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { locale } = await params;
  const { period: raw } = await searchParams;
  const appLocale = locale as AppLocale;

  // The layout already guards this segment; repeating it here means a
  // future refactor that moves the page cannot silently unguard it.
  const session = await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const period: DashboardPeriod = (
    DASHBOARD_PERIODS as readonly string[]
  ).includes(raw ?? "")
    ? (raw as DashboardPeriod)
    : "30d";

  const t = await getTranslations({
    locale: appLocale,
    namespace: "supplier.dashboard",
  });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const companyT = await getTranslations({
    locale: appLocale,
    namespace: "company",
  });
  const rtl = appLocale.startsWith("ar");

  const overview = await loadSupplierDashboard(period);

  if (!overview.ok) {
    return (
      <div className="flex flex-col gap-6">
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={overview.error.requestId ?? undefined}
          requestIdLabel={states("requestIdLabel")}
        />
      </div>
    );
  }

  const data = overview.data;

  return (
    <div className="flex min-w-0 flex-col gap-card-gap">
      {/* WHAT IS STILL MISSING, and a way straight to it. It blocks
          nothing and disappears by being fixed. */}
      <CompletenessBanner
        missing={session.profile.missing}
        href={`/${appLocale}/supplier/account`}
        labels={{
          title: companyT("completeness.title"),
          action: companyT("completeness.action"),
          requirements: Object.fromEntries(
            COMPANY_REQUIREMENTS.map((requirement) => [
              requirement,
              companyT(`completeness.requirement.${requirement}`),
            ]),
          ) as Record<CompanyRequirement, string>,
        }}
      />

      <DashboardHeader
        period={period}
        generatedAtLabel={formatTime(data.generatedAt, appLocale) ?? ""}
        labels={{
          title: t("title"),
          lastUpdated: t("lastUpdated"),
          refresh: t("refresh"),
          periodLabel: t("periodLabel"),
          periods: Object.fromEntries(
            DASHBOARD_PERIODS.map((value) => [value, t(`periods.${value}`)]),
          ) as Record<DashboardPeriod, string>,
        }}
      />

      <SupplierDashboardCards
        cards={data.cards}
        locale={appLocale}
        labels={{
          paidOrders: t("cards.paidOrders"),
          paidOrdersCompare: t("cards.paidOrdersCompare"),
          unsettled: t("cards.unsettled"),
          unsettledNote: t("cards.unsettledNote"),
          buyers: t("cards.buyers"),
          newBuyers: t("cards.newBuyers"),
          noNewBuyers: t("cards.noNewBuyers"),
          opportunities: t("cards.opportunities"),
          endingSoon: t("cards.endingSoon"),
          noneEndingSoon: t("cards.noneEndingSoon"),
          noComparison: t("cards.noComparison"),
        }}
      />

      {/* THE REFERENCE PUTS THE LISTINGS BESIDE THE CHART, with the
          listings on the reading side. */}
      <div className="grid min-w-0 gap-card-gap lg:grid-cols-[1fr_1.4fr]">
        <SalesChart
          series={data.series}
          locale={appLocale}
          labels={{
            title: t("sales.title"),
            subtitle: t("sales.subtitle"),
            refunded: t("sales.refunded"),
            refundsSeparate: t("sales.refundsSeparate"),
            empty: t("sales.empty"),
            thousands: t("sales.thousands"),
            bucket: t(`sales.bucket.${data.series.granularity}`),
          }}
        />

        <ListingsPanel
          listings={data.listings}
          locale={appLocale}
          rtl={rtl}
          labels={{
            title: t("listings.title"),
            viewAll: t("listings.viewAll"),
            manage: t("listings.manage"),
            empty: t("listings.empty"),
            of: t("listings.of"),
            fundedNote: t("listings.fundedNote"),
            soldNote: t("listings.soldNote"),
            endsIn: t("listings.endsIn"),
            endsToday: t("listings.endsToday"),
            day: t("listings.day"),
            days: t("listings.days"),
            noRegion: t("listings.noRegion"),
          }}
        />
      </div>

      <div className="grid min-w-0 gap-card-gap lg:grid-cols-[1fr_1.4fr]">
        <SettlementsPanel
          settlements={data.settlements}
          locale={appLocale}
          rtl={rtl}
          formattedDate={
            data.settlements.lastTransfer
              ? (formatDate(data.settlements.lastTransfer.at, appLocale) ?? null)
              : null
          }
          labels={{
            title: t("settlements.title"),
            transferred: t("settlements.transferred"),
            lastTransfer: t("settlements.lastTransfer"),
            none: t("settlements.none"),
            viewAll: t("settlements.viewAll"),
          }}
        />

        <div className="flex min-w-0 flex-col gap-card-gap">
          <FulfilmentPanel
            counts={data.fulfilment}
            locale={appLocale}
            rtl={rtl}
            labels={{
              title: t("fulfilment.title"),
              viewOrders: t("fulfilment.viewOrders"),
              statuses: Object.fromEntries(
                ORDER_ALLOCATION_STATUSES.map((status) => [
                  status,
                  t(`fulfilment.status.${status}`),
                ]),
              ) as Record<OrderAllocationStatus, string>,
            }}
          />

          {/* «يتطلب انتباهك» IS NOT DRAWN HERE ANY MORE — «انقل «يتطلب
              انتباهك» إلى اختصار تحت الشعار باسم «إجراء مطلوب»». It was
              a card on this page alone, so a supplier working through
              their orders had to come back to the front door to learn
              that a dispute was waiting. It stands beside the tabs now,
              on every page, and pressing it shows the same three
              states. */}
        </div>
      </div>
    </div>
  );
}
