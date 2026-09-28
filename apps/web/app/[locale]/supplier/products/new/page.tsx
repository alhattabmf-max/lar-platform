import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadTaxonomy } from "@/lib/marketplace-data";
import { ErrorState } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { ListingForm } from "@/components/supplier/listing-form";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.products");

/**
 * ADDING A PRODUCT — and nothing else.
 *
 * WHAT IS RECORDED HERE IS NOT FOR SALE. A product is the supplier's
 * own record of a thing they stock: its names, its category, its
 * picture, the unit it is sold in, what is in the carton, and what a
 * carrier needs to move it. No trader sees any of it until an OFFER is
 * made on it, and that is a separate act on the product's own page.
 *
 * THIS PAGE ONCE DID BOTH. Adding and publishing were one submission,
 * which left a supplier no way to build a catalogue ahead of selling
 * from it and no way to offer the same goods twice — the owner's rule:
 * «يسجّل المورد كل منتجاته وتُحفظ لديه، ثم يُنشئ عرضًا على منتجات
 * مختارة، ويعيد الكرّة على نفس المنتج».
 *
 * NOTHING ABOUT THE COMPANY'S RECORD BLOCKS IT. An unverified company
 * with no bank account can fill its catalogue today; the gate is on
 * selling, and it lives where selling happens.
 */
export default async function NewSupplierProductPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({
    locale: appLocale,
    namespace: "supplier.products",
  });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });

  const taxonomy = await loadTaxonomy();

  const backHref = `/${appLocale}/supplier/products`;

  return (
    <div className="flex flex-col gap-2">
      {/* THE TITLE AND THE WAY BACK, ON ONE ROW — «زر العودة في
          إضافة منتج خلّه يسار موازيًا لكلمة إضافة منتج».

          THE SAME ROW THE PRODUCT PAGE NOW HAS, so the two screens
          are left and re-entered the same way. The form's own
          «إلغاء» stays where it is at the foot of the last card:
          that one abandons what has been typed and belongs beside
          the button that saves it, while this one is simply the way
          out of a page.

          NO LINE UNDER IT. «ألغِ الشرح أسفل عناوين الصفحات والأقسام
          والخيارات في كامل المنصه» — the catalogue still carries the
          sentence, and the page does not print it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="text-lg font-semibold text-content">{t("new.title")}</h1>
        <ButtonLink href={backHref} variant="ghost">
          {t("backToProducts")}
        </ButtonLink>
      </div>

      {!taxonomy.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={taxonomy.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : (
        // NO BRANCHES AND NO POLICY BOUNDS ARE READ HERE. Both belong to
        // an offer — where it ships from and how long it runs — and a
        // page that fetched them would be paying for answers this form
        // does not ask for.
        <ListingForm
          scope="product"
          locale={appLocale}
          taxonomy={taxonomy.data}
          backHref={backHref}
        />
      )}
    </div>
  );
}
