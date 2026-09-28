import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { SupplierOpportunitySummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Money } from "@/components/ui/money";
import { OpportunityImage } from "@/components/opportunities/opportunity-image";
import { StatusBadge, type StatusTone } from "@/components/trader/status-badge";

/**
 * ONE PRODUCT, ON ONE ROW — the approved reference for «منتجاتي».
 *
 * IT WAS A GRID OF TALL CARDS, two to a row, each repeating its own
 * labels down a definition list. A supplier scanning twenty products
 * was reading the words «سعر الوحدة» twenty times to compare twenty
 * numbers. The reference lays the same facts out as COLUMNS instead:
 * the picture and the name, then the price, then how much of the
 * target has sold, then when it closes, then the way in. Every row
 * puts its figures in the same place, so the eye compares down a
 * column rather than hunting across a card.
 *
 * THE RULES ARE THE DIVIDERS. Five groups of facts on one line need
 * separating, and a hairline does it without the four extra card
 * edges that a row of small cards would have drawn.
 *
 * IT STACKS ON A PHONE. The columns become rows in the same order —
 * picture first, the way in last — and nothing is hidden to make it
 * fit: `flex-wrap` and a full-width basis below `lg`.
 *
 * NOTHING HERE IS COMPUTED. The percentage is the one exception and
 * it is a PICTURE of two numbers the server sent, drawn beside them
 * rather than instead of them.
 */

export interface ProductRowLabels {
  unitPrice: string;
  priceInclTax: string;
  /** Already interpolated, e.g. «لكل قطعة». Null when there is no unit. */
  perUnit: string | null;
  soldOfTarget: string;
  /** Already interpolated, e.g. «0 من 5,000». */
  soldOfTargetValue: string;
  endsAt: string;
  /** Already formatted in the reader's locale. */
  endsAtValue: string;
  viewDetails: string;
  noImage: string;
  status: string;
  statusTone: StatusTone;
  /** A second badge when the offer is blocked, else null. */
  reason: string | null;
}

/** One cell of the row, with the rule that separates it from the last. */
function Cell({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col justify-center gap-1 border-line px-4 py-1 lg:border-s ${className ?? ""}`}
    >
      {label ? (
        <span className="text-xs font-medium text-content-muted">{label}</span>
      ) : null}
      {children}
    </div>
  );
}

export function ProductRowCard({
  opportunity,
  locale,
  labels,
}: {
  opportunity: SupplierOpportunitySummary;
  locale: AppLocale;
  labels: ProductRowLabels;
}) {
  const name = localized(locale, opportunity.productNameAr, opportunity.productNameEn);
  const href = `/${locale}/supplier/opportunities/${opportunity.id}`;

  // A PICTURE OF THE TWO NUMBERS BESIDE IT, never a third figure. The
  // bar and the percentage both come from `funded` and `target`, which
  // are printed in full right above them.
  const percent =
    opportunity.targetQuantity > 0
      ? Math.min(100, (opportunity.fundedQuantity / opportunity.targetQuantity) * 100)
      : 0;

  return (
    <article className="grid grid-cols-1 items-stretch gap-y-2 rounded-card bg-surface px-card-x py-card-y shadow-card lg:grid-cols-[minmax(0,1fr)_13rem_15rem_10rem_11rem] lg:gap-y-0">
      {/* ---------------------------------------- the product itself */}
      <div className="flex min-w-0 items-center gap-3 px-4 py-1">
        {/* THE BOX SIZES IT, not a class on the component. The image
            carries `w-full` in its own skin and `cn` joins classes
            rather than merging them, so a `size-20` written here loses
            to it in the stylesheet's order and the picture takes the
            whole column. Eighty pixels of container is eighty pixels
            of `w-full`. */}
        <span className="block size-20 shrink-0">
          <OpportunityImage
            src={opportunity.imageUrl}
            productName={name}
            noImageLabel={labels.noImage}
            className="h-full rounded-card"
          />
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1.5">
          <Link
            href={href}
            className="truncate text-base font-semibold text-content hover:text-secondary focus-visible:underline"
          >
            {name}
          </Link>
          <span className="flex flex-wrap gap-1.5">
            <StatusBadge label={labels.status} tone={labels.statusTone} />
            {labels.reason ? <StatusBadge label={labels.reason} tone="attention" /> : null}
          </span>
        </span>
      </div>

      {/* -------------------------------------------------- the price */}
      <Cell label={labels.unitPrice}>
        <span className="text-xl font-semibold text-content">
          <Money
            amount={opportunity.unitPriceAmount}
            currency={opportunity.currency}
            locale={locale}
          />
        </span>
        <span className="text-xs text-content-muted">
          {[labels.perUnit, labels.priceInclTax].filter(Boolean).join(" · ")}
        </span>
      </Cell>

      {/* ------------------------------------------- what has sold */}
      <Cell label={labels.soldOfTarget}>
        <span className="text-sm text-content">{labels.soldOfTargetValue}</span>
        {/* THE BAR IS THE NUMBERS ABOVE IT, drawn. It carries the same
            two values as its accessible name rather than a percentage
            invented for the picture. */}
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={opportunity.targetQuantity}
          aria-valuenow={opportunity.fundedQuantity}
          aria-label={labels.soldOfTarget}
          className="block h-2 w-full overflow-hidden rounded-full bg-background"
        >
          <span
            className="block h-full rounded-full bg-secondary"
            style={{ inlineSize: `${percent}%` }}
          />
        </span>
        <span className="text-xs text-content-muted">
          {formatQuantity(Math.round(percent), locale)}%
        </span>
      </Cell>

      {/* --------------------------------------------- when it closes */}
      <Cell label={labels.endsAt}>
        {/* A DIRECT LISTING HAS NO CLOSING DATE. The cell shows whatever
            the caller put in `endsAtValue` — «بلا مدة» — without a
            `time` element claiming an instant that does not exist. */}
        {opportunity.endAt === null ? (
          <span className="text-sm text-content">{labels.endsAtValue}</span>
        ) : (
          <time dateTime={opportunity.endAt} className="text-sm text-content">
            {labels.endsAtValue}
          </time>
        )}
      </Cell>

      {/* ------------------------------------------------- the way in */}
      <Cell className="lg:items-end">
        <Link
          href={href}
          className="inline-flex min-h-nav items-center justify-center gap-2 rounded-control border border-secondary px-control-x text-sm font-medium text-secondary hover:bg-background"
        >
          {labels.viewDetails}
          <ArrowLeft aria-hidden className="size-4 shrink-0 ltr:-scale-x-100" />
        </Link>
      </Cell>
    </article>
  );
}
