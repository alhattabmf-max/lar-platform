import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import {
  loadPolicyLimits,
  loadSupplierLocations,
  loadSupplierOpportunities,
  loadSupplierProduct,
} from "@/lib/supplier-data";
import { opportunityIsLive } from "@/lib/opportunity-actions";
import { referenceFailureRequestId } from "@/lib/reference-data";
import { localized } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { ListingForm } from "@/components/supplier/listing-form";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.opportunities.direct");


/**
 * SELLING ONE PRODUCT DIRECTLY, FROM STOCK.
 *
 * «المورد يحدد المنتج وسعر الوحدة والكمية ووحدة البيع وأيام التجهيز.»
 *
 * THE SAME FORM AS AN OFFER, MINUS THE CLOCK. A direct listing asks a
 * price, a quantity — which is STOCK here, not a collective target —
 * the branch it ships from, and how many days the supplier needs to
 * prepare. It has no duration, because «لا مدة انتهاء»: a shelf stays
 * up until its owner takes it down.
 *
 * AND IT IS NOT IN THE WAY OF A GROUP OFFER. «نفس المنتج يمكن أن يكون
 * له بيع مباشر نشط وعرض جماعي نشط في الوقت نفسه» — the one-live-listing
 * rule is per sale mode, so the notice about a running offer below
 * names only another DIRECT listing on the same product.
 * *
 * WHICH PRODUCT IS IN THE ADDRESS, not in a dropdown. The offer is
 * reached from the product's own page, so the answer is already known;
 * a select asking it again would be a question with one answer, and it
 * would let a supplier change the subject of the form halfway through.
 *
 * ONE LIVE OFFER AT A TIME — AND THE RULE BITES ON PUBLISHING, NOT ON
 * WRITING. Two live offers on one product compete for the same stock
 * and can between them sell more than the supplier has, so the server
 * refuses the second publication. Preparing it is another matter: «إنشاء
 * العرض كمسودة مسموح في أي وقت؛ الممنوع هو النشر ما دام على المنتج عرض
 * حيّ». So the form opens either way, the notice at its head names the
 * offer that is running and links to it, and «حفظ كمسودة» stays live
 * while «نشر العرض» does not.
 *
 * AN UNKNOWN ID AND ANOTHER COMPANY'S PRODUCT both answer 404 from the
 * API — deliberately, so probing reveals nothing — and this renders
 * Next's own 404 for either, which preserves that.
 */
export default async function NewDirectListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.opportunities" });
  const products = await getTranslations({ locale: appLocale, namespace: "supplier.products" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const [result, locations, policyLimits, offers] = await Promise.all([
    loadSupplierProduct(id),
    loadSupplierLocations(),
    loadPolicyLimits(),
    loadSupplierOpportunities(),
  ]);

  if (!result.ok && result.notFound) notFound();

  const backHref = `/${appLocale}/supplier/products/${id}`;

  // THE SAME PLAIN LINE THE ADD-PRODUCT PAGE WEARS. Its bar is gone
  // too, and the way back out of this form is in the strip the layout
  // draws above — one row per page, always in the same place.
  const heading = <h1 className="text-lg font-semibold text-content">{t("direct.title")}</h1>;

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-2">
        {heading}
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
  const name = localized(appLocale, product.nameAr, product.nameEn);

  // WHICH OFFER IS IN THE WAY, so the form can name it and link to it
  // rather than saying "another one is running" and leaving the
  // supplier to find it.
  //
  // A read that failed names none, which is the safe way round: the
  // server refuses a second publication regardless, and a page that
  // blocked the button on a list it could not read would stop a
  // supplier who has no live offer at all.
  const liveOffer = offers.ok
    ? offers.data.find(
        (offer) =>
          offer.productId === product.id &&
          // PER SALE MODE. A running GROUP offer does not stand in the
          // way of a direct sale on the same product, and the server
          // agrees: its refusal is scoped to the same mode.
          offer.saleMode === "DIRECT" &&
          opportunityIsLive(offer.status)
      )
    : undefined;

  // A closed or archived product cannot be sold at all — and unlike a
  // running offer, that is not something a draft is waiting for.
  const sellable = product.archivedAt === null && product.approvalStatus !== "CLOSED";

  if (!sellable) {
    return (
      <div className="flex flex-col gap-2">
        {heading}
        <Card ariaLabel={products("offersTitle")} className="border-warning">
          <CardHeader>
            <CardTitle>{name ?? products("offersTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-content-muted">{products("offerNotSellable")}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {heading}

      {/* WHICH PRODUCT THIS IS ABOUT, said once. The form below asks
          nothing about it, so without this line the page would be four
          numbers with no subject. */}
      {name ? <p className="text-sm text-content-muted">{name}</p> : null}

      {!locations.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={referenceFailureRequestId(locations)}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : (
        <ListingForm
          scope="direct"
          locale={appLocale}
          productId={product.id}
          liveOfferHref={
            liveOffer ? `/${appLocale}/supplier/opportunities/${liveOffer.id}` : undefined
          }
          locations={locations.data}
          backHref={backHref}
          // Undefined when the policy read failed — the form then warns
          // that bounds exist without naming figures it made up.
          limits={policyLimits.ok ? policyLimits.data.opportunity : undefined}
        />
      )}
    </div>
  );
}
