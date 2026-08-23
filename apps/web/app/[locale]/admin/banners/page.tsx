import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { BANNER_PLACEMENTS, type BannerPlacement } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminBanners } from "@/lib/admin-data";
import { ErrorState, LoadingState } from "@/components/ui/states";
import {
  BannerManager,
  type BannerManagerLabels,
} from "@/components/admin/banner-manager";

/**
 * Promotional banners, one section per placement.
 *
 * BOTH PLACEMENTS ON ONE PAGE, each with its own ordered list. The
 * reorder endpoint takes a placement and the full sequence within it,
 * and the server holds an advisory lock per placement — so the two lists
 * are independent and must not be merged into one draggable column.
 *
 * A placement whose read fails renders its own error and the other still
 * works: they are separate requests and there is no reason one outage
 * should take down both.
 */
export default async function AdminBannersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.banners" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content-muted">
        {t("imageNotice")}
      </p>

      {BANNER_PLACEMENTS.map((placement) => (
        <section key={placement} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-content">{t(`placements.${placement}`)}</h2>
          <Suspense fallback={<LoadingState label={common("loading")} rows={3} />}>
            <Placement locale={appLocale} placement={placement} />
          </Suspense>
        </section>
      ))}
    </div>
  );
}

async function Placement({
  locale,
  placement,
}: {
  locale: AppLocale;
  placement: BannerPlacement;
}) {
  const t = await getTranslations({ locale, namespace: "admin.banners" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadAdminBanners(placement);

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

  const labels: BannerManagerLabels = {
    createLegend: t("createLegend"),
    titleAr: t("titleAr"),
    titleEn: t("titleEn"),
    bodyAr: t("bodyAr"),
    bodyEn: t("bodyEn"),
    linkUrl: t("linkUrl"),
    linkHint: t("linkHint"),
    create: t("create"),

    moveUp: (title: string) => t("moveUp", { title }),
    moveDown: (title: string) => t("moveDown", { title }),
    saveOrder: t("saveOrder"),
    orderChanged: t("orderChanged"),
    orderSaved: t("orderSaved"),

    activate: t("activate"),
    deactivate: t("deactivate"),
    hasImage: t("hasImage"),
    noImage: t("noImage"),
    stateLabel: (state: string) => vocab(`bannerState.${state}`),
    scheduleFrom: t("scheduleFrom"),
    scheduleTo: t("scheduleTo"),
    saveSchedule: t("saveSchedule"),
    scheduleHint: t("scheduleHint"),

    working: t("working"),
    required: t("required"),
    empty: t("empty"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

  return <BannerManager placement={placement} banners={result.data} labels={labels} />;
}
