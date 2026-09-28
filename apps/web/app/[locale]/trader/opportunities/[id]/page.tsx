import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadTraderLocations, loadTraderOpportunity } from "@/lib/trader-data";
import { loadCities, loadRegions } from "@/lib/marketplace-data";
import { localized } from "@/lib/localized";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { OpportunityDetail } from "@/components/opportunities/opportunity-detail";
import { loadTaxonomy } from "@/lib/marketplace-data";
import { PurchaseComposer } from "@/components/checkout/purchase-composer";
import type { SelectableLocation } from "@/lib/purchase-composer";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.opportunities");


/**
 * One opportunity with its commercial terms.
 *
 * This is the trader counterpart of the public detail page, which
 * carries no price, quantity, share size or purchase step at all. The
 * split is enforced by two different endpoints behind two different
 * guards, not by a conditional on this page.
 *
 * The terms shown here are read straight from the API. Nothing is
 * multiplied, summed or projected: a trader picks a quantity in
 * checkout, and the totals come back from the frozen quote the payment
 * provider will actually charge. A "your total would be…" figure
 * computed here would be a second source of truth, and the one on
 * screen is the one a person believes.
 *
 * A 404 covers unknown ids, not-yet-visible and no-longer-visible ones
 * alike, so that probing ids confirms nothing. This page preserves that
 * by rendering the same Next 404 for all of them.
 *
 * The purchase composer at the bottom is the only place a checkout
 * session is created. Its branch list is fetched HERE, on the server,
 * so the client is handed the ids it may use rather than asking for
 * them — there is no code path in which a location id comes from
 * anywhere but `/companies/me/locations`, which the API scopes to the
 * caller's company and filters to active rows.
 */
export default async function TraderOpportunityDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-3">
      {/* NO WAY BACK ON THE PAGE — «الشيء الثاني مكتوب في الصفحة الرجوع
          إلى المنتجات وماخذة حيز… تقدر تلغي التصنيفات من الشريط إذا دخلت
          تفاصيل المنتج وتحط مكانها عودة».

          IT MOVED RATHER THAN VANISHED. The strip above already carries
          a back link on every form in this portal, and it is drawn
          whether or not this body has resolved — so the way back is
          available while loading, which is what the line here was for.
          Two of them would be two answers to one question. */}
      <Suspense fallback={<LoadingState label={common("loading")} rows={5} />}>
        <DetailBody locale={appLocale} id={id} />
      </Suspense>
    </div>
  );
}

async function DetailBody({ locale, id }: { locale: AppLocale; id: string }) {
  const t = await getTranslations({ locale, namespace: "trader.opportunities" });
  const marketplace = await getTranslations({ locale, namespace: "marketplace" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadTraderOpportunity(id);

  if (!result.ok && result.notFound) notFound();

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

  const opportunity = result.data;

  // THE ONE VALUE THIS PAGE STILL DERIVES FOR ITSELF: the composer
  // needs the selling unit's NAME to label a quantity. Everything the
  // four cards read is derived inside `OpportunityDetail`, once, for
  // both fronts.
  const unit = localized(locale, opportunity.salesUnitNameAr, opportunity.salesUnitNameEn);

  /**
   * THE CATEGORY'S NAME, resolved from the taxonomy the chrome loads.
   *
   * The snapshot freezes a taxonomy NODE ID, not a name — freezing the
   * name would mean a category renamed in the catalogue reads one way
   * on an old offer and another on a new one. The id is stable and the
   * name is looked up, which is what this page already does for the
   * buyer's own regions and cities.
   *
   * A FAILED READ COSTS THE NAME, NOT THE PAGE, and it renders as an
   * absence rather than as a raw uuid — which would be worse than
   * nothing.
   */
  const taxonomy = await loadTaxonomy();
  const category =
    opportunity.taxonomyNodeId && taxonomy.ok
      ? (() => {
          const node = taxonomy.data.find(
            (candidate) => candidate.id === opportunity.taxonomyNodeId,
          );
          return node ? localized(locale, node.nameAr, node.nameEn) : null;
        })()
      : null;

  return (
    <OpportunityDetail
      locale={locale}
      opportunity={opportunity}
      category={category}
      labels={{
        productLabel: t("detail.productLabel"),
        deliveryLabel: t("detail.deliveryLabel"),
        packageLabel: t("detail.packageLabel"),
        buyNow: t("detail.buyNow"),
        gallery: t("detail.gallery"),
        galleryItem: (index, name) => t("detail.galleryItem", { index, name }),
        noImage: marketplace("card.noImage"),
        scheduled: marketplace("card.scheduled"),
        noDescription: marketplace("detail.noDescription"),
        taxonomy: t("detail.taxonomy"),
        priceIncludesTax: t("detail.priceIncludesTax"),
        priceUnavailable: t("priceUnavailable"),
        targetQuantity: marketplace("card.targetQuantity"),
        remainingQuantity: marketplace("card.remainingQuantity"),
        sold: t("sold"),
        shareQuantity: t("detail.shareQuantity"),
        progressAriaLabel: (percent) => marketplace("progress.ariaLabel", { percent }),
        unsoldCaveat: t("detail.unsoldCaveat"),
        progressCaveat: t("detail.progressCaveat"),
        city: marketplace("card.city"),
        region: marketplace("detail.region"),
        preparationTime: t("detail.preparationTime"),
        preparationDays: (days) => t("detail.preparationDays", { days }),
        opens: marketplace("detail.opens"),
        closes: marketplace("card.closes"),
        remainingTime: t("detail.remainingTime"),
        closed: marketplace("detail.closed"),
        closesInDays: (days) => marketplace("card.closesInDays", { days }),
        unit: marketplace("card.unit"),
        packageContent: t("detail.packageContent"),
        weightPerUnit: t("detail.weightPerUnit"),
        dimensions: t("detail.dimensions"),
        cm: t("detail.cm"),
        length: t("detail.length"),
        width: t("detail.width"),
        height: t("detail.height"),
      }}
      /* THE ONLY PLACE A CHECKOUT SESSION IS CREATED. Its branch list is
         fetched on the SERVER, so the client is handed the ids it may
         use rather than asking for them — there is no code path in
         which a location id comes from anywhere but
         `/companies/me/locations`, which the API scopes to the caller's
         company and filters to active rows. */
      purchase={
        <PurchaseRegion
          locale={locale}
          opportunityId={opportunity.id}
          // ZERO MEANS «NO STEP AND NO MINIMUM», which is exactly what a
          // direct sale is: the buyer names any quantity up to what is
          // left. The composer already treats a non-positive share that
          // way — it steps by one and applies no multiple rule — so the
          // two modes need no second code path here.
          shareQuantity={opportunity.shareQuantity ?? 0}
          // THE CEILING COUNTS OTHER BUYERS. `unsoldQuantity` is target
          // minus sold and ignores what is held in open baskets;
          // `availableQuantity` is the arithmetic the checkout actually
          // performs under the offer row lock, so it is the ceiling a
          // picker may offer without being refused a moment later.
          unsoldQuantity={opportunity.availableQuantity}
          salesUnitName={unit}
        />
      }
    />
  );
}




/**
 * The branch list the composer may choose from.
 *
 * Read on the server and passed down as plain data. City names come
 * from the cached geography reference data; if that read fails the
 * branches still render, with the city omitted rather than an id shown
 * in its place.
 *
 * Coordinates are never included — they are on the row, they mean
 * nothing to a reader, and a latitude is not an address.
 */
async function PurchaseRegion({
  locale,
  opportunityId,
  shareQuantity,
  unsoldQuantity,
  salesUnitName,
}: {
  locale: AppLocale;
  opportunityId: string;
  shareQuantity: number;
  unsoldQuantity: number;
  salesUnitName: string | null;
}) {
  const states = await getTranslations({ locale, namespace: "states" });

  // BOTH LISTS: a branch is recorded against a region and may name a
  // city beneath it, so identifying one on this form needs both.
  const [locationsResult, regions, cities] = await Promise.all([
    loadTraderLocations(),
    loadRegions(),
    loadCities(),
  ]);

  if (!locationsResult.ok) {
    // Without the branch list there is nothing valid to submit, so this
    // fails visibly rather than rendering a form that cannot work.
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={locationsResult.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const regionName = (regionId: string): string | null => {
    if (!regions.ok) return null;
    const region = regions.data.find((r) => r.id === regionId);
    return region ? localized(locale, region.nameAr, region.nameEn) : null;
  };

  const cityName = (cityId: string | null): string | null => {
    if (cityId === null || !cities.ok) return null;
    const city = cities.data.find((c) => c.id === cityId);
    return city ? localized(locale, city.nameAr, city.nameEn) : null;
  };

  const locations: SelectableLocation[] = locationsResult.data.map((location) => ({
    id: location.id,
    name: location.name,
    regionName: regionName(location.regionId),
    cityName: cityName(location.cityId),
    shortAddress: location.shortAddress,
  }));

  return (
    <PurchaseComposer
      opportunityId={opportunityId}
      locale={locale}
      shareQuantity={shareQuantity}
      unsoldQuantity={unsoldQuantity}
      salesUnitName={salesUnitName}
      locations={locations}
      accountLocationsHref={`/${locale}/trader/account/locations`}
      // ONE OF THREE CARDS, not the whole screen — «اختصرها فقط في
      // تحديد الكمية وتحديد الفرع بدون شروحات غير مهمة».
      compact
    />
  );
}
