import type { PublicOpportunityItem } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized, formatDate } from "@/lib/localized";
import type { OpportunityCardLabels } from "@/components/opportunities/opportunity-card";
import type { OfferProgressLabels } from "@/components/opportunities/offer-progress";

/**
 * Builds a card's copy from an offer, in one place.
 *
 * The homepage and `/opportunities` render the same card, and both need
 * the same seven interpolations. Written twice, they drift — one grid
 * says "100 pallets" and the other "100", or one forgets the accessible
 * name and announces "View details" once per card.
 *
 * Takes the translator rather than importing one: the caller is a server
 * component that already has a scoped `getTranslations`, and threading it
 * through keeps this file free of any opinion about namespaces.
 */
type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * A quantity, as a BARE NUMBER.
 *
 * The unit is deliberately not appended. Arabic inflects a counted noun
 * by the count — ten pallets is "طبليات", ninety is "طبلية" — and
 * `SalesUnit` stores exactly one name. Gluing that one name to every
 * figure produces "10 طبلية", which is wrong, and guessing the plural
 * from the number would be inventing grammar from data the platform
 * does not have.
 *
 * The unit is shown once, on its own row, where it needs no agreement
 * with anything. Proper singular/dual/plural forms per selling unit are
 * a separate improvement and need a schema change.
 */
function quantity(count: number): string {
  return String(count);
}

export function offerProgressLabels(
  t: Translate,
  opportunity: PublicOpportunityItem,
  locale: AppLocale,
): OfferProgressLabels {
  const sold = Math.min(
    100,
    Math.max(0, Math.round(opportunity.progressPercentage)),
  );
  // NULL ON A DIRECT LISTING — it has no window. `formatDate` is not
  // asked about a date that does not exist.
  const endsOn = opportunity.endAt === null ? null : formatDate(opportunity.endAt, locale);

  return {
    // "remaining" is 100 − sold, from the same rounded figure the bar
    // draws, so the marker and the sentence can never disagree.
    remaining: t("progress.remaining", { percent: 100 - sold }),
    // A null date means the value was unparseable; the caller's own
    // copy for that case is not this component's business, so the label
    // degrades to the bare prefix rather than printing "Invalid Date".
    endsAt: endsOn === null ? "" : t("progress.endsAt", { date: endsOn }),
    ariaLabel: t("progress.ariaLabel", { percent: sold }),
  };
}

export function offerCardLabels(
  t: Translate,
  opportunity: PublicOpportunityItem,
  locale: AppLocale,
): OpportunityCardLabels {
  const name = localized(
    locale,
    opportunity.productNameAr,
    opportunity.productNameEn,
  );

  return {
    regionLabel: t("card.region"),
    unitLabel: t("card.unit"),
    targetLabel: t("card.targetQuantity"),
    remainingLabel: t("card.remainingQuantity"),
    minimumOrderLabel: t("card.minimumOrder"),
    priceInclTax: t("card.priceInclTax"),
    priceUnavailable: t("card.priceUnavailable"),
    scheduledBadge: t("card.scheduled"),
    noImage: t("card.noImage"),
    viewDetails: t("card.viewDetails"),
    viewDetailsFor: t("card.viewDetailsFor", { name }),
    targetValue: quantity(opportunity.targetQuantity),
    remainingValue: quantity(opportunity.unsoldQuantity),
    // A DIRECT LISTING HAS NO MINIMUM AND NO STEP: the buyer names any
    // quantity up to what is left. An em dash rather than «0», which
    // would read as a minimum of nothing.
    minimumOrderValue:
      opportunity.shareQuantity === null ? "—" : quantity(opportunity.shareQuantity),
    progress: offerProgressLabels(t, opportunity, locale),
    // WHAT A DIRECT CARD SAYS INSTEAD OF A PROGRESS BAR AND A CLOCK.
    //
    // «البيع المباشر يظهر السعر والمخزون المتاح واختيار الكمية» — a
    // shelf has no target to be a percentage of and no date to count
    // down to, so the two captions under the bar are replaced by one
    // line that says how much is left, or that there is none.
    saleMode: opportunity.saleMode,
    stockLabel:
      opportunity.unsoldQuantity > 0
        ? t("card.stockLeft", { count: opportunity.unsoldQuantity })
        : t("card.soldOut"),
    soldOut: opportunity.unsoldQuantity <= 0,
  };
}
