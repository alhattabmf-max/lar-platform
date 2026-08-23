import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSalesUnits, loadTaxonomy } from "@/lib/marketplace-data";
import { referenceFailureRequestId } from "@/lib/reference-data";
import { EMPTY_PRODUCT_FORM } from "@/lib/product-form";
import { ErrorState } from "@/components/ui/states";
import { ProductForm } from "@/components/supplier/product-form";
import { productFormLabels } from "@/components/supplier/product-form-labels";

/**
 * Creating a product.
 *
 * CREATING IS NOT APPROVING. The product is saved as a DRAFT and nothing
 * else happens: the technical checks run only when the supplier submits it,
 * and they require a main image, which a brand-new product cannot have. The
 * copy says so before the form rather than after a confusing refusal.
 *
 * The three steps stay three requests — create, then upload, then submit.
 * Presenting them as one action would be a transaction this product does
 * not have: the id has to exist before an image can be attached to it, and
 * an upload that failed after a successful create must not read as though
 * nothing was saved.
 *
 * Taxonomy and sales units are anonymous, cacheable reference data. If
 * either cannot be read the form is NOT rendered — a category picker with
 * no categories would invite someone to fill in everything else and then
 * discover they cannot finish.
 */
export default async function NewSupplierProductPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.products" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const [taxonomy, salesUnits] = await Promise.all([loadTaxonomy(), loadSalesUnits()]);

  const backHref = `/${appLocale}/supplier/products`;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link href={backHref} className="inline-flex min-h-11 items-center text-secondary hover:opacity-90">
          {t("backToProducts")}
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("new.title")}</h1>
        <p className="text-sm text-content-muted">{t("new.description")}</p>
      </header>

      {/* Said before the form, not after: what saving does and what it
          does not do. */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-content">{t("new.nextStepsTitle")}</h2>
        <ol className="mt-2 flex list-decimal flex-col gap-1 ps-5 text-sm text-content-muted">
          <li>{t("new.step1")}</li>
          <li>{t("new.step2")}</li>
          <li>{t("new.step3")}</li>
        </ol>
      </div>

      {!taxonomy.ok || !salesUnits.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={referenceFailureRequestId(taxonomy, salesUnits)}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : (
        <ProductForm
          mode="create"
          locale={appLocale}
          initialValues={EMPTY_PRODUCT_FORM}
          taxonomy={taxonomy.data}
          salesUnits={salesUnits.data}
          backHref={backHref}
          labels={await productFormLabels(appLocale)}
        />
      )}
    </div>
  );
}
