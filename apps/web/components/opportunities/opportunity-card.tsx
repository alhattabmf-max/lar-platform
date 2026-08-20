import Link from "next/link";
import type { PublicOpportunityItem } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized, formatDate, daysUntil } from "@/lib/localized";
import { OpportunityImage } from "./opportunity-image";

/**
 * One opportunity in the marketplace grid.
 *
 * Everything shown comes from `PublicOpportunityItem`, which carries no
 * price, no quantity, no share size and no purchase step. That is not
 * an omission to be filled in later on this card — the commercial terms
 * live behind the trader guard, and a card is exactly where a
 * placeholder price would be most tempting and most wrong.
 */
export interface OpportunityCardLabels {
  cityLabel: string;
  unitLabel: string;
  closesLabel: string;
  /** Interpolated, e.g. "Closes in 5 days". */
  closesIn: string | null;
  closingSoonBadge: string | null;
  scheduledBadge: string | null;
  noImage: string;
  viewDetails: string;
}

export interface OpportunityCardProps {
  opportunity: PublicOpportunityItem;
  locale: AppLocale;
  labels: OpportunityCardLabels;
}

export function OpportunityCard({ opportunity, locale, labels }: OpportunityCardProps) {
  const name = localized(locale, opportunity.productNameAr, opportunity.productNameEn);
  const city = localized(
    locale,
    opportunity.fulfillmentCityNameAr,
    opportunity.fulfillmentCityNameEn
  );
  const unit = localized(locale, opportunity.salesUnitNameAr, opportunity.salesUnitNameEn);
  const closes = formatDate(opportunity.endAt, locale);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <OpportunityImage
        src={opportunity.thumbnailUrl}
        productName={name}
        noImageLabel={labels.noImage}
        className="h-40"
      />

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-start gap-2">
          <h3 className="flex-1 text-base font-semibold text-content">
            {/* The whole card is not a link: a nested-interactive card
                gives a keyboard user one enormous tab stop and an
                unreadable accessible name. The heading carries the link,
                and it names the destination. */}
            <Link
              href={`/${locale}/opportunities/${opportunity.id}`}
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

        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-content-muted">{labels.cityLabel}:</dt>
            <dd className="text-content">{city}</dd>
          </div>

          {unit ? (
            <div className="flex gap-2">
              <dt className="text-content-muted">{labels.unitLabel}:</dt>
              <dd className="text-content">{unit}</dd>
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

        {labels.closesIn ? (
          <p
            className={
              labels.closingSoonBadge
                ? "mt-auto text-sm font-medium text-warning-text"
                : "mt-auto text-sm text-content-muted"
            }
          >
            {labels.closesIn}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Days remaining, or null once the window has closed.
 *
 * Exported so the page can compute it once per item and hand down
 * already-translated copy — the card holds no message catalogue of its
 * own.
 */
export function remainingDays(endAt: string, now?: Date): number | null {
  return daysUntil(endAt, now);
}

/**
 * Below this many days remaining, the closing notice is emphasised.
 *
 * Three days is a judgement call, not a business rule — nothing in the
 * API changes at this threshold. It lives here as a named constant so
 * it is obviously presentational and can be changed in one place.
 */
export const CLOSING_SOON_DAYS = 3;
