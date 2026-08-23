import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierProduct } from "@/lib/supplier-data";
import { productActions, productNextStepKey } from "@/lib/product-actions";
import { localized, formatDate } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList, StatusWithAction } from "@/components/trader/account-panels";
import { ErrorState } from "@/components/ui/states";
import { ProductActions } from "@/components/supplier/product-actions";
import { ProductMediaManager } from "@/components/supplier/product-media-manager";

/**
 * One product, with its images and the actions the API will accept.
 *
 * An unknown id and another company's product both answer 404 from the API —
 * deliberately, so probing reveals nothing — and this renders Next's own 404
 * for either, which preserves that. An error state instead would imply the
 * record exists and is broken.
 *
 * Every action is gated by `productActions()`, transcribed from the service's
 * own guards. A button the API would refuse is never drawn; when the gate and
 * the server disagree, the server wins and shows its refusal.
 *
 * There is no edit form. `PATCH /companies/me/products/:id` exists, but the
 * field-editing screen is not built, so no "edit" affordance appears — a
 * control that opens nothing promises an action the product cannot perform.
 */
export default async function SupplierProductDetailPage({
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
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  const result = await loadSupplierProduct(id);

  if (!result.ok && result.notFound) notFound();

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb locale={appLocale} label={t("breadcrumbLabel")} back={t("backToProducts")} />
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
  const archived = product.archivedAt !== null;
  const created = formatDate(product.createdAt, appLocale);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb locale={appLocale} label={t("breadcrumbLabel")} back={t("backToProducts")} />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{name}</h1>
        <p className="text-sm text-content-muted">
          {localized(appLocale, product.salesUnitNameAr, product.salesUnitNameEn)}
        </p>
      </header>

      {/* The status and what to do about it, together. A bare
          "SUSPENDED" tells someone nothing about what happens next. */}
      <Card ariaLabel={t("statusTitle")} className={gate.canSubmit ? "border-warning" : undefined}>
        <CardHeader>
          <CardTitle>{t("statusTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-4">
            <StatusWithAction
              label={t("statusLabel")}
              status={
                archived
                  ? status("productArchived")
                  : status(`product.${product.approvalStatus}`)
              }
              action={t(`nextStep.${productNextStepKey(product)}`)}
              tone={
                archived
                  ? "neutral"
                  : product.approvalStatus === "APPROVED"
                    ? "success"
                    : gate.canSubmit || product.approvalStatus === "SUSPENDED"
                      ? "warning"
                      : "neutral"
              }
            />

            {product.rejectionReason ? (
              <FactList>
                <Fact label={t("rejectionReason")} value={product.rejectionReason} />
              </FactList>
            ) : null}

            {/* The edit link appears only where the API's own edit guard
                would accept a write — the same gate the media panel uses.
                A link into a form that cannot be saved is worse than no
                link: someone fills it in first and finds out after. */}
            {gate.canEditMedia ? (
              <Link
                href={`/${appLocale}/supplier/products/${product.id}/edit`}
                className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
              >
                {t("actions.edit")}
              </Link>
            ) : null}

            <ProductActions
              productId={product.id}
              gate={gate}
              labels={{
                submit: t("actions.submit"),
                submitPrompt: t("actions.submitPrompt"),
                archive: t("actions.archive"),
                archivePrompt: t("actions.archivePrompt"),
                confirm: common("confirm"),
                cancel: common("cancel"),
                submitting: t("actions.working"),
                errorTitle: states("errorTitle"),
                requestIdLabel: states("requestIdLabel"),
              }}
            />
          </div>
        </CardBody>
      </Card>

      <ProductMediaManager
        productId={product.id}
        media={product.media}
        canEdit={gate.canEditMedia}
        productName={name}
        labels={{
          heading: t("media.heading"),
          empty: t("media.empty"),
          // `.raw` because these two are TEMPLATES the client fills per
          // image — the index is not known until the list is mapped.
          // Interpolating them here would need one call per image and a
          // prop shaped like the array's order.
          imageAlt: t.raw("media.imageAlt"),
          mainImageAlt: t.raw("media.mainImageAlt"),
          mainBadge: t("media.mainBadge"),
          setMain: t("media.setMain"),
          remove: t("media.remove"),
          removePrompt: t("media.removePrompt"),
          confirm: common("confirm"),
          cancel: common("cancel"),
          working: t("actions.working"),
          addImage: t("media.addImage"),
          addImageHint: t("media.addImageHint"),
          openFull: t("media.openFull"),
          errorTitle: states("errorTitle"),
          requestIdLabel: states("requestIdLabel"),
          moveUp: t.raw("media.moveUp"),
          moveDown: t.raw("media.moveDown"),
          reorderHint: t("media.reorderHint"),
        }}
      />

      <Card ariaLabel={t("specification")}>
        <CardHeader>
          <CardTitle>{t("specification")}</CardTitle>
        </CardHeader>
        <CardBody>
          <FactList>
            {/* Physical measurements, at the precision the API sends
                them. Decimal strings, rendered as-is: they are not
                money, and no arithmetic happens here either. */}
            <Fact label={t("weightPerUnit")} value={product.weightPerUnit} />
            <Fact
              label={t("dimensions")}
              value={`${product.lengthCm} × ${product.widthCm} × ${product.heightCm}`}
            />
            {product.packageContentQuantity ? (
              <Fact
                label={t("packageContent")}
                value={`${product.packageContentQuantity} ${
                  localized(
                    appLocale,
                    product.packageContentUnitNameAr,
                    product.packageContentUnitNameEn
                  ) ?? ""
                }`.trim()}
              />
            ) : null}
            {created ? <Fact label={t("createdAt")} value={created} /> : null}
          </FactList>

          {localized(appLocale, product.descriptionAr, product.descriptionEn) ? (
            <p className="mt-4 whitespace-pre-line text-sm text-content">
              {localized(appLocale, product.descriptionAr, product.descriptionEn)}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

async function Breadcrumb({
  locale,
  label,
  back,
}: {
  locale: AppLocale;
  label: string;
  back: string;
}) {
  return (
    <nav aria-label={label} className="text-sm">
      <Link
        href={`/${locale}/supplier/products`}
        className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
      >
        {back}
      </Link>
    </nav>
  );
}
