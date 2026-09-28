import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminTaxonomy } from "@/lib/admin-data";
import { ErrorState, LoadingState } from "@/components/ui/states";
import {
  TaxonomyManager,
  type TaxonomyManagerLabels,
} from "@/components/admin/taxonomy-manager";

/**
 * «إدارة التصنيفات» — the catalogue's categories, on their own screen.
 *
 * IT LEFT THE REFERENCE-DATA PAGE because it was never the same kind
 * of thing. Regions, cities and sales units are flat lists that a table
 * shows completely; categories are a tree, and a table showed one
 * flattened into rows with a parent's name printed beside each — which
 * is the shape of the data, not the shape of the thing.
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
    namespace: "admin.taxonomy",
  });
  return { title: t("title") };
}

export default async function AdminTaxonomyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.taxonomy",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });

  return (
    <div className="flex flex-col gap-6">
      {/* STILL A HEADING, just not a second copy of the sidebar —
          «احذف عنوان الصفحة «إدارة التصنيفات» عشان التكرار». The row
          under the orange rule names the screen and the sidebar entry
          beside it is lit; reading it a third time is redundant.
          Reading it with a SCREEN READER is how somebody knows which
          page they landed on, because they can see neither. */}
      <h1 className="sr-only">{t("title")}</h1>

      <Suspense fallback={<LoadingState label={common("loading")} rows={5} />}>
        <Tree locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Tree({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.taxonomy" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadAdminTaxonomy();

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

  const labels: TaxonomyManagerLabels = {
    addRoot: t("addRoot"),
    addChild: t("addChild"),
    edit: t("edit"),
    remove: t("remove"),
    nameAr: t("nameAr"),
    nameEn: t("nameEn"),
    sortOrder: t("sortOrder"),
    sortOrderHint: t("sortOrderHint"),
    save: t("save"),
    cancel: t("cancel"),
    empty: t("empty"),
    active: t("active"),
    inactive: t("inactive"),
    activate: t("activate"),
    deactivate: t("deactivate"),
    confirmRemove: t("confirmRemove"),
    depthReached: t("depthReached"),
    moveRoot: t("moveRoot"),
    requestIdLabel: states("requestIdLabel"),
    treeTitle: t("treeTitle"),
    products: t("products"),
    state: t("state"),
  };

  return (
    <TaxonomyManager nodes={result.data} labels={labels} locale={locale} />
  );
}
