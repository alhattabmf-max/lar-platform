import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadAdminCities,
  loadAdminRegions,
  loadAdminSalesUnits,
  loadAdminTaxonomy,
} from "@/lib/admin-data";
import { localized } from "@/lib/localized";
import { ErrorState } from "@/components/ui/states";
import {
  ReferenceDataManager,
  type ReferenceDataManagerLabels,
  type ReferenceRow,
} from "@/components/admin/reference-data-manager";

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

  const [taxonomy, salesUnits, regions, cities] = await Promise.all([
    loadAdminTaxonomy(),
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
  const taxonomyNames = taxonomy.ok
    ? new Map(taxonomy.data.map((node) => [node.id, localized(appLocale, node.nameAr, node.nameEn)]))
    : new Map<string, string>();

  const taxonomyRows: ReferenceRow[] = taxonomy.ok
    ? taxonomy.data.map((node) => ({
        id: node.id,
        nameAr: node.nameAr,
        nameEn: node.nameEn,
        isActive: node.isActive,
        context: node.parentId
          ? t("underParent", { parent: taxonomyNames.get(node.parentId) ?? t("unknownParent") })
          : undefined,
      }))
    : [];

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("taxonomyTitle")}</h2>
        <p className="text-sm text-content-muted">{t("taxonomyHint")}</p>
        {taxonomy.ok ? (
          <ReferenceDataManager basePath="/admin/taxonomy" rows={taxonomyRows} labels={labels} />
        ) : (
          failed
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("salesUnitsTitle")}</h2>
        <p className="text-sm text-content-muted">{t("salesUnitsHint")}</p>
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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("regionsTitle")}</h2>
        {regions.ok ? (
          <ReferenceDataManager
            basePath="/admin/regions"
            rows={regions.data.map((region) => ({
              id: region.id,
              nameAr: region.nameAr,
              nameEn: region.nameEn,
              isActive: region.isActive,
            }))}
            labels={labels}
          />
        ) : (
          failed
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("citiesTitle")}</h2>
        {cities.ok && regions.ok ? (
          <ReferenceDataManager
            basePath="/admin/cities"
            rows={cities.data.map((city) => ({
              id: city.id,
              nameAr: city.nameAr,
              nameEn: city.nameEn,
              isActive: city.isActive,
              context: localized(appLocale, city.regionNameAr, city.regionNameEn),
            }))}
            parentField={{
              name: "regionId",
              label: t("region"),
              // ACTIVE regions only: the API refuses to create a city
              // under an inactive one, so offering them would be
              // offering a choice that always fails.
              options: regions.data
                .filter((region) => region.isActive)
                .map((region) => ({
                  value: region.id,
                  label: localized(appLocale, region.nameAr, region.nameEn),
                })),
            }}
            labels={labels}
          />
        ) : (
          failed
        )}
      </section>
    </div>
  );
}
