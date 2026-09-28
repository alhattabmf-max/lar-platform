import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminProduct, loadAdminTaxonomy } from "@/lib/admin-data";
import { formatDate, localized } from "@/lib/localized";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { AdminAction } from "@/components/admin/admin-action";
import { AdminProductEditForm } from "@/components/admin/admin-product-edit-form";
import { AdminProductImages } from "@/components/admin/admin-product-images";

/**
 * ONE PRODUCT, IN THE SUPPLIER'S OWN CARDS.
 *
 * «استخدم بطاقة إضافة المنتج في صفحة المورد نفس ترتيبها بالضبط، وبدل
 *  إضافة منتج زر تعديل وجنبه إلغاء وزر شطب وزر إيقاف.»
 *
 * WHAT THIS PAGE IS NOW: the supplier's «إضافة منتج» arrangement, read
 * back for a product that already exists — the picture beside the names
 * in its own ruled column, then how it is sold, then what it takes to
 * move it — and a row of four answers under it.
 *
 * WHAT WAS MISSING BEFORE ANY OF IT. The register lists products and
 * acts on them — suspend, reactivate, erase — and nothing could READ
 * one. Deciding to stop somebody's product from a name and a status is
 * not reviewing it.
 *
 * THE LIVE-OFFER LOCK DOES NOT APPLY HERE, and the page says so rather
 * than leaving it to be discovered. A SUPPLIER is refused an edit while
 * a buyer can reach the product; support exists precisely for the cases
 * the supplier cannot fix. What the notice states is the consequence: a
 * published offer renders from its own frozen snapshot, so an edit
 * reaches the record and every offer published AFTER it — never the one
 * a buyer is looking at now.
 *
 * THE PICTURES ARE EDITABLE TOO — «حتى الصورة اجعلها قابلة للتعديل».
 * The same four operations the supplier has, through the same service,
 * each recorded under a name that says the console did it.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as AppLocale,
    namespace: "admin.products",
  });
  return { title: t("detailTitle") };
}

export default async function AdminProductDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.products" });
  const listing = await getTranslations({
    locale: appLocale,
    namespace: "supplier.listings.form",
  });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const actions = await getTranslations({ locale: appLocale, namespace: "admin.actions" });

  // The category tree is loaded beside the product rather than after it:
  // the form needs both, and two sequential reads would make the page
  // wait for its own list of categories.
  const [result, taxonomy] = await Promise.all([
    loadAdminProduct(id),
    loadAdminTaxonomy(),
  ]);

  if (!result.ok) {
    if (result.error.kind === "notFound") notFound();
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={result.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const product = result.data;
  const name = localized(appLocale, product.nameAr, product.nameEn);
  const archived = product.archivedAt !== null;

  const actionLabels = {
    confirm: actions("confirm"),
    cancel: actions("cancel"),
    working: actions("working"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

  return (
    <div className="flex flex-col gap-2">
      {/* The name, its state, and — where one was recorded — why. One
          line above the cards, the way the supplier's own page carries
          its title. */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-content">{name}</h1>
        <StatusBadge
          label={vocab(`productState.${product.approvalStatus}`)}
          tone={
            product.approvalStatus === "APPROVED"
              ? "done"
              : product.approvalStatus === "SUSPENDED"
                ? "attention"
                : "neutral"
          }
        />
        {archived ? <StatusBadge label={t("archived")} /> : null}

        <span className="ms-auto flex flex-wrap items-center gap-x-3 text-xs text-content-muted">
          <Link
            href={`/${locale}/admin/companies/${product.companyId}`}
            className="text-secondary hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {product.companyLegalName}
          </Link>
          <span>
            {t("liveOffers")} {product.liveOfferCount}
          </span>
          <time dateTime={product.updatedAt}>
            {formatDate(product.updatedAt, appLocale)}
          </time>
        </span>
      </div>

      {product.rejectionReason ? (
        <p className="text-xs text-content-muted">{product.rejectionReason}</p>
      ) : null}

      {/* WHAT AN EDIT REACHES, stated before anybody types rather than
          after they save. A published offer is built from its own frozen
          ProductApprovalSnapshot and renders from it, so a buyer looking
          at an offer sees what they always saw. */}
      {product.liveOfferCount > 0 ? (
        <p
          role="note"
          className="text-xs text-content"
          data-testid="admin-product-live-notice"
        >
          {t("liveOfferNotice", { count: product.liveOfferCount })}
        </p>
      ) : null}

      <AdminProductEditForm
        product={product}
        taxonomy={taxonomy.ok ? taxonomy.data : []}
        locale={appLocale}
        cancelHref={`/${locale}/admin/products`}
        images={
          <AdminProductImages
            productId={product.id}
            media={product.media}
            labels={{
              title: listing("fields.image"),
              choose: listing("image.choose"),
              empty: t("imagesEmpty"),
              setMain: t("imageSetMain"),
              remove: t("imageRemove"),
              main: t("mainImage"),
              working: actions("working"),
              errorTitle: states("errorTitle"),
            }}
          />
        }
        actions={
          <>
            {/* TWO DOORS, NOT THREE. Suspend is the reversible one;
                erase is the final one. «إذا فيه مشكلة في المنتج أوقفه
                مؤقتًا، وإذا كان الحل ليس في الإيقاف المؤقت خلاص يُحذف
                نهائيًّا.» */}
            {product.approvalStatus === "APPROVED" ? (
              <AdminAction
                path={`/admin/products/${product.id}/suspend`}
                variant="danger"
                reason={{
                  field: "reason",
                  label: t("suspendReason"),
                  minLength: 5,
                  maxLength: 2000,
                  hint: t("cascadeHint"),
                }}
                labels={{
                  ...actionLabels,
                  action: t("suspend"),
                  prompt: t("suspendPrompt", { name }),
                }}
              />
            ) : product.approvalStatus === "SUSPENDED" ? (
              <AdminAction
                path={`/admin/products/${product.id}/reactivate`}
                labels={{
                  ...actionLabels,
                  action: t("reactivate"),
                  prompt: t("reactivatePrompt", { name }),
                }}
              />
            ) : null}

            <AdminAction
              path={`/admin/products/${product.id}`}
              method="DELETE"
              variant="danger"
              labels={{
                ...actionLabels,
                action: t("deleteForever"),
                prompt: t("deletePrompt", { name }),
              }}
            />
          </>
        }
        labels={{
          save: t("saveEdit"),
          cancel: actions("cancel"),
          working: actions("working"),
          saved: t("editSaved"),
          noChange: t("editNoChange"),
          errorTitle: states("errorTitle"),
          requestIdLabel: states("requestIdLabel"),
        }}
      />
    </div>
  );
}
