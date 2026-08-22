import Link from "next/link";
import type { AppLocale } from "@/i18n/routing";
import type { TraderOpportunityItem } from "@platform/types";
import { localized, formatDate } from "@/lib/localized";
import { formatMoney, formatPercentage, formatQuantity } from "@/lib/money";

/**
 * One opportunity in the trader's list, terms included.
 *
 * The public card exists precisely because it must NOT show these
 * numbers; this one is its counterpart behind the trader guard, and
 * the two are kept separate rather than one card with a `showTerms`
 * flag — a flag is one wrong prop away from printing a price on the
 * anonymous marketplace.
 *
 * Two rules the copy has to keep:
 *
 *  - `progressPercentage` is the share of the supply cap SOLD. It is
 *    not funding and not a goal; nothing unlocks when it reaches 100%,
 *    because every paid order is fulfilled on its own.
 *  - `unsoldQuantity` is arithmetic, not a reservation. Checkout's
 *    lock is the only authority on what can actually be bought, so it
 *    is never labelled "available".
 *
 * The card computes no total. It shows the unit price the server sent
 * and stops there; multiplying by a quantity here would produce a
 * figure that can disagree with the frozen quote checkout charges.
 */
export interface TraderOpportunityCardLabels {
  unitPriceLabel: string;
  cityLabel: string;
  soldLabel: string;
  /** Already interpolated, e.g. "4 cartons per share". */
  shareText: string | null;
  unsoldLabel: string;
  closesLabel: string;
  scheduledBadge: string | null;
  viewDetails: string;
  priceUnavailable: string;
}

export function TraderOpportunityCard({
  opportunity,
  locale,
  labels,
}: {
  opportunity: TraderOpportunityItem;
  locale: AppLocale;
  labels: TraderOpportunityCardLabels;
}) {
  const name = localized(locale, opportunity.productNameAr, opportunity.productNameEn);
  const unit = localized(locale, opportunity.salesUnitNameAr, opportunity.salesUnitNameEn);
  const city = localized(
    locale,
    opportunity.fulfillmentCityNameAr,
    opportunity.fulfillmentCityNameEn
  );
  const price = formatMoney(opportunity.unitPriceInclTaxAmount, opportunity.currency, locale);
  const sold = formatPercentage(opportunity.progressPercentage, locale);
  const closes = formatDate(opportunity.endAt, locale);

  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <h3 className="flex-1 text-base font-semibold text-content">
          <Link
            href={`/${locale}/trader/opportunities/${opportunity.id}`}
            className="hover:text-secondary focus-visible:underline"
          >
            {name}
          </Link>
        </h3>

        {opportunity.status === "SCHEDULED" && labels.scheduledBadge ? (
          <span className="rounded-md bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning-text">
            {labels.scheduledBadge}
          </span>
        ) : null}
      </div>

      <p className="text-lg font-semibold text-content">
        {/* A malformed amount renders as a stated absence. "0.00" would
            be a claim about what this costs. */}
        {price ? (
          <>
            {price}
            {unit ? <span className="text-sm font-normal text-content-muted"> / {unit}</span> : null}
          </>
        ) : (
          <span className="text-sm font-normal text-content-muted">
            {labels.priceUnavailable}
          </span>
        )}
      </p>

      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-content-muted">{labels.cityLabel}:</dt>
          <dd className="text-content">{city}</dd>
        </div>

        {sold ? (
          <div className="flex gap-2">
            <dt className="text-content-muted">{labels.soldLabel}:</dt>
            <dd className="text-content">{sold}</dd>
          </div>
        ) : null}

        <div className="flex gap-2">
          <dt className="text-content-muted">{labels.unsoldLabel}:</dt>
          <dd className="text-content">
            {formatQuantity(opportunity.unsoldQuantity, locale)}
            {unit ? ` ${unit}` : ""}
          </dd>
        </div>

        {labels.shareText ? (
          <div className="flex gap-2">
            <dd className="text-content-muted">{labels.shareText}</dd>
          </div>
        ) : null}

        {closes ? (
          <div className="flex gap-2">
            <dt className="text-content-muted">{labels.closesLabel}:</dt>
            <dd className="text-content">
              <time dateTime={opportunity.endAt}>{closes}</time>
            </dd>
          </div>
        ) : null}
      </dl>

      <Link
        href={`/${locale}/trader/opportunities/${opportunity.id}`}
        className="mt-auto text-sm text-secondary hover:opacity-90"
      >
        {labels.viewDetails}
      </Link>
    </article>
  );
}
