import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BANNER_PLACEMENTS, type BannerPlacement } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminBanners, loadBannerImageShape } from "@/lib/admin-data";
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
    namespace: "admin.banners",
  });
  return { title: t("title") };
}

export default async function AdminBannersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.banners",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>

      {BANNER_PLACEMENTS.map((placement) => (
        <section key={placement} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-content">
            {t(`placements.${placement}`)}
          </h2>
          <Suspense
            fallback={<LoadingState label={common("loading")} rows={3} />}
          >
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
  const states = await getTranslations({ locale, namespace: "states" });

  // Both reads in flight together: the shape does not depend on the
  // rows, and waiting for one before starting the other would add a
  // round-trip to every section for nothing.
  const [result, imageShape] = await Promise.all([
    loadAdminBanners(placement),
    loadBannerImageShape(),
  ]);

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
    linkUrl: t("linkUrl"),
    linkHint: t("linkHint"),
    create: t("create"),

    // moveUp / moveDown / stateLabel are deliberately absent: they take
    // a runtime argument, and a function cannot be serialized across the
    // server/client boundary. BannerManager translates them itself.
    saveOrder: t("saveOrder"),
    orderChanged: t("orderChanged"),
    orderSaved: t("orderSaved"),

    activate: t("activate"),
    deactivate: t("deactivate"),
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

  return (
    <BannerManager
      placement={placement}
      banners={result.data}
      labels={labels}
      imageShape={imageShape}
    />
  );
}
