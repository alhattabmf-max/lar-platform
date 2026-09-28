import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { loadOpportunityDetail, loadTaxonomy } from "@/lib/marketplace-data";
import { localized } from "@/lib/localized";
import { loginPath, portalPathFor } from "@/lib/auth-redirects";
import { getSession } from "@/lib/session";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { OpportunityDetail } from "@/components/opportunities/opportunity-detail";
import { VisitorQuantity } from "@/components/opportunities/visitor-quantity";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("marketplace");


/**
 * How large the product photo is allowed to get on a wide screen.
 *
 * The image is square, so its width is also its height — left
 * uncapped in a half-page column it becomes a ~700px tall block and
 * everything a visitor came to read starts below the fold. This is the
 * ceiling, not the size: narrower columns use what they have.
 *
 * The progress bar underneath shares the constant so the two always
 * line up.
 */

/**
 * A single opportunity, for anyone — signed in or not.
 *
 * What is NOT on this page is as deliberate as what is: no price, no
 * quantity, no share size, no purchase step, no preparation time. The
 * public contract does not carry them, so they cannot be rendered here
 * even by mistake; the notice explains the absence and points to sign-in
 * rather than leaving a visitor to assume the listing is broken.
 *
 * A 404 from the API covers unknown ids, opportunities that are not
 * publicly visible, and ones that no longer are — one indistinguishable
 * answer, so that probing ids cannot confirm anything exists. This page
 * preserves that by rendering the same Next 404 for all of them.
 */
export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;

  const t = await getTranslations({
    locale: appLocale,
    namespace: "marketplace",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Rendered before the fetch resolves, so the way back is
          available even while the opportunity is still loading. */}
      <nav aria-label={t("detail.breadcrumbLabel")} className="text-sm">
        <Link
          href={`/${appLocale}/opportunities`}
          className="text-secondary hover:opacity-[var(--state-hover-opacity)]"
        >
          {t("detail.backToList")}
        </Link>
      </nav>

      <Suspense fallback={<LoadingState label={common("loading")} rows={5} />}>
        <DetailBody locale={appLocale} id={id} />
      </Suspense>
    </div>
  );
}

async function DetailBody({ locale, id }: { locale: AppLocale; id: string }) {
  // WHO IS ASKING decides which invitation is shown. Offering "create
  // an account" to somebody who already has one is the same defect as
  // offering "sign in" to somebody already signed in — this page did
  // both, to every signed-in visitor who reached it.
  const session = await getSession();
  const appLocale = locale;
  const t = await getTranslations({
    locale: appLocale,
    namespace: "marketplace",
  });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });

  const result = await loadOpportunityDetail(id);

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

  // THE ADDRESS A SIGN-IN RETURNS TO. Every value the four cards read
  // is derived inside `OpportunityDetail`, once, for both fronts.
  const returnTo = `/${appLocale}/opportunities/${opportunity.id}`;

  /**
   * THE CATEGORY'S NAME, resolved from the taxonomy rather than frozen.
   *
   * The snapshot freezes a taxonomy NODE ID, not a name — freezing the
   * name would mean a category renamed in the catalogue reads one way
   * on an old offer and another on a new one.
   *
   * A FAILED READ COSTS THE NAME, NOT THE PAGE, and it renders as an
   * absence rather than as a raw uuid, which would be worse than
   * nothing.
   */
  const taxonomy = await loadTaxonomy();
  const category =
    opportunity.taxonomyNodeId && taxonomy.ok
      ? (() => {
          const node = taxonomy.data.find(
            (candidate) => candidate.id === opportunity.taxonomyNodeId,
          );
          return node ? localized(appLocale, node.nameAr, node.nameEn) : null;
        })()
      : null;

  return (
    /* THE SAME FOUR CARDS THE BUYER SEES — «بطاقة عرض تفاصيل المنتج في
       صفحة الزائر عدّلها مثل عرض تفاصيل المنتج في صفحة المشتري».
       ONE COMPONENT, NOT A SECOND COPY. See the note at the head of
       `OpportunityDetail`: two files cannot stay identical, and these
       two screens are meant to BE identical apart from what fills the
       purchase card. */
    <OpportunityDetail
      locale={appLocale}
      opportunity={opportunity}
      category={category}
      labels={{
        productLabel: t("detail.productLabel"),
        deliveryLabel: t("detail.deliveryLabel"),
        packageLabel: t("detail.packageLabel"),
        buyNow: t("detail.buyNow"),
        gallery: t("detail.gallery"),
        galleryItem: (index, name) => t("detail.galleryItem", { index, name }),
        noImage: t("card.noImage"),
        scheduled: t("card.scheduled"),
        noDescription: t("detail.noDescription"),
        taxonomy: t("detail.taxonomy"),
        priceIncludesTax: t("detail.priceIncludesTax"),
        priceUnavailable: t("card.priceUnavailable"),
        targetQuantity: t("card.targetQuantity"),
        remainingQuantity: t("card.remainingQuantity"),
        sold: t("card.sold"),
        shareQuantity: t("detail.shareQuantity"),
        progressAriaLabel: (percent) => t("progress.ariaLabel", { percent }),
        unsoldCaveat: t("detail.unsoldCaveat"),
        progressCaveat: t("detail.progressCaveat"),
        city: t("card.city"),
        region: t("detail.region"),
        preparationTime: t("detail.preparationTime"),
        preparationDays: (days) => t("detail.preparationDays", { days }),
        opens: t("detail.opens"),
        closes: t("card.closes"),
        remainingTime: t("detail.remainingTime"),
        closed: t("detail.closed"),
        closesInDays: (days) => t("card.closesInDays", { days }),
        unit: t("card.unit"),
        packageContent: t("detail.packageContent"),
        weightPerUnit: t("detail.weightPerUnit"),
        dimensions: t("detail.dimensions"),
        cm: t("detail.cm"),
        length: t("detail.length"),
        width: t("detail.width"),
        height: t("detail.height"),
      }}
      /* THE SLOT A VISITOR GETS. The stepper is here so the figures can
         be tried out before anybody signs up — the quantities are open
         to everyone and only COMPLETING a purchase is gated, which is
         what the notice underneath says in words. */
      purchase={
        <>
          <VisitorQuantity
            label={t("detail.quantityLabel")}
            increaseLabel={t("detail.increase")}
            decreaseLabel={t("detail.decrease")}
            // A DIRECT LISTING HAS NO STEP: one, because the buyer names
            // any quantity up to what is left.
            step={opportunity.shareQuantity ?? 1}
            max={opportunity.unsoldQuantity}
          />

          <div className="flex flex-wrap gap-2">
            {session ? (
              // Their own portal's view of this same offer, where the
              // purchase step exists.
              <ButtonLink
                href={`${portalPathFor(appLocale, session.company.accountType as "TRADER" | "SUPPLIER")}/opportunities/${id}`}
                variant="secondary"
                size="sm"
              >
                {t("detail.openInPortal")}
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href={`/${appLocale}/register`} variant="secondary" size="sm">
                  {t("detail.registerToBuy")}
                </ButtonLink>
                <ButtonLink
                  href={loginPath(appLocale, returnTo)}
                  variant="secondary"
                  size="sm"
                >
                  {t("detail.signIn")}
                </ButtonLink>
              </>
            )}
          </div>

          {/* Says plainly what is and is not gated. Nothing to tell
              somebody who already has an account. */}
          {session ? null : (
            <p className="text-xs text-content-muted">{t("detail.visitorNotice")}</p>
          )}
        </>
      }
    />
  );
}


