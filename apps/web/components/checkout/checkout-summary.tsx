import type { ReactNode } from "react";
import type { CheckoutSessionView } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Money } from "@/components/ui/money";

/**
 * The frozen quote, exactly as the server stored it.
 *
 * Every figure here comes from `quote_snapshots`, which is written once
 * when the session is created and never recomputed — it is the amount
 * the payment provider will be asked for. This component therefore
 * DISPLAYS and never calculates: it does not multiply the unit price by
 * the quantity, does not sum the allocations, and does not derive the
 * grand total. Each of those would be a second source of truth, and the
 * one on the screen is the one a person believes.
 *
 * Money arrives as fixed-scale decimal strings and is parsed once, at
 * render, by `formatMoney`. A malformed amount renders as a stated
 * absence rather than "0.00", because a zero is a claim about cost.
 */
export interface CheckoutSummaryLabels {
  quoteLabel: string;
  unitPrice: string;
  quantity: string;
  productsExclTax: string;
  tax: string;
  productsInclTax: string;
  shipping: string;
  grandTotal: string;
  amountUnavailable: string;
  destinationsLabel: string;
  destinationQuantity: string;
  destinationShipping: string;
}

interface CheckoutSummaryProps {
  session: CheckoutSessionView;
  locale: AppLocale;
  labels: CheckoutSummaryLabels;
}

/**
 * The quote's own lines, in the order a reader adds them up.
 *
 * THE AMOUNT IS AN ELEMENT, not a string: the riyal's symbol is a
 * drawing, so what a line holds is the thing that renders it. Nothing
 * about the FIGURE changes here — it is the frozen quote's own decimal
 * string, formatted at the edge of rendering and never recomputed.
 */
function quoteLines(
  session: CheckoutSessionView,
  locale: AppLocale,
  labels: CheckoutSummaryLabels,
): { label: string; amount: ReactNode; emphasis?: boolean }[] {
  const money = (amount: string) => (
    <Money
      amount={amount}
      currency={session.currency}
      locale={locale}
      fallback={<span className="text-content-muted">{labels.amountUnavailable}</span>}
    />
  );

  return [
    { label: labels.unitPrice, amount: money(session.unitPriceInclTaxAmount) },
    { label: labels.productsExclTax, amount: money(session.productsSubtotalExclTaxAmount) },
    { label: labels.tax, amount: money(session.productsTaxAmount) },
    { label: labels.productsInclTax, amount: money(session.productsSubtotalInclTaxAmount) },
    { label: labels.shipping, amount: money(session.totalShippingFeeAmount) },
    { label: labels.grandTotal, amount: money(session.grandTotalAmount), emphasis: true },
  ];
}

/** The figures: what is being bought, and what it comes to. */
export function CheckoutQuote({
  session,
  locale,
  labels,
}: CheckoutSummaryProps) {
  const unit = localized(locale, session.salesUnitNameAr, session.salesUnitNameEn);
  const lines = quoteLines(session, locale, labels);

  return (
    <section
      aria-label={labels.quoteLabel}
      data-testid="checkout-quote"
      className="rounded-card bg-surface px-card-x py-card-y shadow-card"
    >
      <h2 className="mb-2 text-base font-semibold text-content">{labels.quoteLabel}</h2>

        <dl className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-4 text-sm">
            <dt className="text-content-muted">{labels.quantity}</dt>
            <dd className="text-content">
              {formatQuantity(session.quantity, locale)}
              {unit ? ` ${unit}` : ""}
            </dd>
          </div>

          {lines.map((line) => (
            <div
              key={line.label}
              className={
                line.emphasis
                  ? "flex justify-between gap-4 border-t border-line pt-2 text-base font-semibold text-content"
                  : "flex justify-between gap-4 text-sm"
              }
            >
              <dt className={line.emphasis ? "" : "text-content-muted"}>{line.label}</dt>
              <dd className={line.emphasis ? "" : "text-content"}>
                {line.amount}
              </dd>
            </div>
          ))}
        </dl>
    </section>
  );
}

/** Where each part of the order goes, and what its shipping costs. */
export function CheckoutDestinations({
  session,
  locale,
  labels,
}: CheckoutSummaryProps) {
  const unit = localized(locale, session.salesUnitNameAr, session.salesUnitNameEn);

  return (
    <section
      aria-label={labels.destinationsLabel}
      data-testid="checkout-destinations"
      className="rounded-card bg-surface px-card-x py-card-y shadow-card"
    >
      <h2 className="mb-2 text-base font-semibold text-content">{labels.destinationsLabel}</h2>

        <ul className="flex list-none flex-col gap-2">
          {session.allocations.map((allocation) => {
            return (
              <li
                key={allocation.companyLocationId}
                className="rounded-card border border-line px-3 py-2"
              >
                <p className="text-sm font-medium text-content">{allocation.locationName}</p>
                {/*
                  THE REGION, NARROWED BY THE CITY WHEN THERE IS ONE.

                  A branch may name no city, and this line used to read
                  « · address» when it did not — a separator with
                  nothing before it. The region is always present, so
                  the place is never blank.
                */}
                <p className="text-sm text-content-muted">
                  {[
                    localized(locale, allocation.regionNameAr, allocation.regionNameEn),
                    localized(locale, allocation.cityNameAr, allocation.cityNameEn),
                    allocation.address,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="text-content-muted">{labels.destinationQuantity}:</dt>
                    <dd className="text-content">
                      {formatQuantity(allocation.quantity, locale)}
                      {unit ? ` ${unit}` : ""}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-content-muted">{labels.destinationShipping}:</dt>
                    <dd className="text-content">
                      <Money
                        amount={allocation.shippingFeeAmount}
                        currency={session.currency}
                        locale={locale}
                        fallback={
                          <span className="text-content-muted">
                            {labels.amountUnavailable}
                          </span>
                        }
                      />
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
    </section>
  );
}
