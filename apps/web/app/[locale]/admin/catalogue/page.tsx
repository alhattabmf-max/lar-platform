import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadAdminCities,
  loadAdminRegions,
  loadAdminSalesUnits,
} from "@/lib/admin-data";
import { ErrorState } from "@/components/ui/states";
import {
  ReferenceDataManager,
  type ReferenceDataManagerLabels,
} from "@/components/admin/reference-data-manager";
import { GeographyManager } from "@/components/admin/geography-manager";

/**
 * The platform's reference data, on one screen.
 *
 * Categories, selling units, regions and cities together rather than
 * four pages: they are edited in the same sitting — a new region is
 * usually followed straight away by its cities — and each list is short
 * enough that splitting them would mean four navigations to do one job.
 *
 * NOTHING HERE CAN BE DELETED. Every one of these rows is referenced by
 * products, addresses or opportunities, and the API has no delete for
 * any of them. Deactivating hides a row from every picker while leaving
 * the records that already point at it intact, which is what "retiring a
 * category" actually has to mean.
 *
 * CITIES ARE LISTED UNDER THEIR REGION, because a city name alone is
 * ambiguous and because the API refuses to create a city under an
 * inactive region.
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
    namespace: "admin.catalogue",
  });
  return { title: t("title") };
}

export default async function AdminCataloguePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.catalogue" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const [salesUnits, regions, cities] = await Promise.all([
    loadAdminSalesUnits(),
    loadAdminRegions(),
    loadAdminCities(),
  ]);

  const labels: ReferenceDataManagerLabels = {
    addLegend: t("addLegend"),
    nameAr: t("nameAr"),
    nameEn: t("nameEn"),
    add: t("add"),
    rename: t("rename"),
    save: t("save"),
    cancel: t("cancel"),
    activate: t("activate"),
    deactivate: t("deactivate"),
    deactivatePrompt: t("deactivatePrompt"),
    activePill: t("active"),
    inactivePill: t("inactive"),
    working: t("working"),
    required: t("required"),
    notDeleteNotice: t("notDeleteNotice"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

  const failed = (
    <ErrorState
      title={states("errorTitle")}
      description={states("errorDescription")}
      requestIdLabel={states("requestIdLabel")}
    />
  );

  // Category names, so a child node can show which parent it sits under.
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>

      {/* CATEGORIES ARE NOT HERE ANY MORE. They are a tree, and this
          page showed one flattened into rows with a parent name printed
          beside each. They have their own screen: «إدارة التصنيفات». */}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("salesUnitsTitle")}</h2>
        {salesUnits.ok ? (
          <ReferenceDataManager
            basePath="/admin/sales-units"
            rows={salesUnits.data.map((unit) => ({
              id: unit.id,
              nameAr: unit.nameAr,
              nameEn: unit.nameEn,
              isActive: unit.isActive,
            }))}
            labels={labels}
          />
        ) : (
          failed
        )}
      </section>

      {/*
        ONE SECTION FOR BOTH, hierarchical. They were two flat lists, so
        a hundred and fifty-two cities filled a column with their region
        printed underneath each as a caption — the list was shaped the
        opposite way round from the data. A region is the operational
        unit and its cities belong to it.
      */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">
          {t("geographyTitle")}
        </h2>
        {regions.ok && cities.ok ? (
          <GeographyManager
            regions={regions.data.map((region) => ({
              id: region.id,
              nameAr: region.nameAr,
              nameEn: region.nameEn,
              isActive: region.isActive,
              cities: cities.data
                .filter((city) => city.regionId === region.id)
                .map((city) => ({
                  id: city.id,
                  nameAr: city.nameAr,
                  nameEn: city.nameEn,
                  isActive: city.isActive,
                })),
            }))}
            labels={{
              addRegion: t("addRegion"),
              addCity: t("addCity"),
              nameAr: t("nameAr"),
              nameEn: t("nameEn"),
              add: t("add"),
              rename: t("rename"),
              save: t("save"),
              cancel: t("cancel"),
              activate: t("activate"),
              deactivate: t("deactivate"),
              deactivateRegionPrompt: t("deactivateRegionPrompt"),
              deactivateCityPrompt: t("deactivateCityPrompt"),
              activePill: t("activePill"),
              inactivePill: t("inactivePill"),
              regionInactiveNotice: t("regionInactiveNotice"),
              noCities: t("noCities"),
              working: t("working"),
              required: t("required"),
              notDeleteNotice: t("notDeleteNotice"),
              errorTitle: states("errorTitle"),
              requestIdLabel: states("requestIdLabel"),
            }}
          />
        ) : (
          failed
        )}
      </section>

    </div>
  );
}
