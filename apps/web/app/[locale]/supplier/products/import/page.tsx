import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadTaxonomy } from "@/lib/marketplace-data";
import { ErrorState } from "@/components/ui/states";
import { ProductImporter } from "@/components/supplier/product-importer";

export default async function ImportProductsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");
  const t = await getTranslations({ locale: appLocale, namespace: "supplier.products.bulkImport" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const taxonomy = await loadTaxonomy();
  return <main className="flex flex-col gap-5">
    <header className="flex items-center justify-between gap-4"><h1 className="text-lg font-semibold">{t("title")}</h1><Link href={`/${locale}/supplier/products`} className="text-sm underline">{t("back")}</Link></header>
    {taxonomy.ok ? <ProductImporter locale={locale} taxonomy={taxonomy.data} labels={{
      help: t("help"), template: t("template"), categories: t("categories"), csv: t("csv"),
      photos: t("photos"), ready: t("ready"), view: t("view"), saved: t("saved"),
      import: t("import"), importing: t("importing"), fileTooLarge: t("fileTooLarge"),
      duplicateImage: t("duplicateImage"), missingImage: t("missingImage"), inspectDraft: t("inspectDraft"),
    }} /> : <ErrorState title={states("errorTitle")} description={states("errorDescription")} requestId={taxonomy.error.requestId} requestIdLabel={states("requestIdLabel")} />}
  </main>;
}
