import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierProduct } from "@/lib/supplier-data";
import { loadSalesUnits, loadTaxonomy } from "@/lib/marketplace-data";
import { referenceFailureRequestId } from "@/lib/reference-data";
import { productActions, productNextStepKey } from "@/lib/product-actions";
import { productFormFromDetail } from "@/lib/product-form";
import { localized } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusWithAction } from "@/components/trader/account-panels";
import { ErrorState } from "@/components/ui/states";
import { ProductForm } from "@/components/supplier/product-form";
import { productFormLabels } from "@/components/supplier/product-form-labels";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.products");


/**
 * Editing a product.
 *
 * The form is rendered ONLY in the states the API's own `assertEditableTx`
 * accepts. PENDING_REVIEW, CLOSED and archived get no form and no write
 * path at all — they get the reason and a way back, because a form that
 * cannot be saved is worse than no form: someone fills it in first and
 * learns afterwards.
 *
 * An unknown id and another company's product both answer 404 from the API,
 * and this renders Next's own 404 for either, which preserves that.
 *
 * Note what an edit does on an APPROVED product: it re-runs the technical
 * checks inside the same transaction and, if they pass, writes a new
 * approval snapshot. If they fail the whole edit is refused — so a save can
 * come back as `PRODUCT_TECHNICAL_CHECK_FAILED` rather than a field error,
 * and the form maps those codes onto the fields they belong to.
 */
export default async function EditProductDetailsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.products" });
  const status = await getTranslations({ locale: appLocale, namespace: "supplier.status" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const result = await loadSupplierProduct(id);

  if (!result.ok && result.notFound) notFound();

  const detailHref = `/${appLocale}/supplier/products/${id}`;

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb href={detailHref} label={t("breadcrumbLabel")} back={t("backToProduct")} />
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      </div>
    );
  }

  const product = result.data;
  const gate = productActions(product);
  const name = localized(appLocale, product.nameAr, product.nameEn);

  // Not editable: no form, no write, and a reason. Rendered before the
  // reference data is even fetched — there is nothing to build a picker
  // for.
  if (!gate.canEditMedia) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb href={detailHref} label={t("breadcrumbLabel")} back={t("backToProduct")} />

        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-content">{t("edit.title")}</h1>
          <p className="text-sm text-content-muted">{name}</p>
        </header>

        <Card ariaLabel={t("edit.lockedTitle")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("edit.lockedTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <StatusWithAction
              label={t("statusLabel")}
              status={
                product.archivedAt !== null
                  ? status("product.ARCHIVED")
                  : status(`product.${product.approvalStatus}`)
              }
              action={t(`nextStep.${productNextStepKey(product)}`)}
              tone="warning"
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  const [taxonomy, salesUnits] = await Promise.all([loadTaxonomy(), loadSalesUnits()]);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb href={detailHref} label={t("breadcrumbLabel")} back={t("backToProduct")} />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("edit.title")}</h1>
        <p className="text-sm text-content-muted">{name}</p>
      </header>

      {product.approvalStatus === "APPROVED" ? (
        // The one consequence a supplier cannot guess: saving re-runs the
        // checks, and a change that would leave the product incomplete is
        // refused as a whole rather than half-applied.
        <p className="rounded-card bg-surface px-card-x py-card-y text-sm text-content-muted shadow-card">
          {t("edit.approvedNotice")}
        </p>
      ) : null}

      {!taxonomy.ok || !salesUnits.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={referenceFailureRequestId(taxonomy, salesUnits)}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : (
        <ProductForm
          mode="edit"
          locale={appLocale}
          productId={product.id}
          initialValues={productFormFromDetail(product)}
          taxonomy={taxonomy.data}
          salesUnits={salesUnits.data}
          backHref={detailHref}
          labels={await productFormLabels(appLocale)}
        />
      )}
    </div>
  );
}

function Breadcrumb({ href, label, back }: { href: string; label: string; back: string }) {
  return (
    <nav aria-label={label} className="text-sm">
      <Link href={href} className="inline-flex min-h-nav items-center text-secondary hover:opacity-[var(--state-hover-opacity)]">
        {back}
      </Link>
    </nav>
  );
}
