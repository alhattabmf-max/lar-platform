import type { CheckoutSessionView } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { formatMoney, formatQuantity } from "@/lib/money";

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

export function CheckoutSummary({
  session,
  locale,
  labels,
}: {
  session: CheckoutSessionView;
  locale: AppLocale;
  labels: CheckoutSummaryLabels;
}) {
  const unit = localized(locale, session.salesUnitNameAr, session.salesUnitNameEn);
  const money = (amount: string) => formatMoney(amount, session.currency, locale);

  const lines: { label: string; amount: string | null; emphasis?: boolean }[] = [
    { label: labels.unitPrice, amount: money(session.unitPriceInclTaxAmount) },
    { label: labels.productsExclTax, amount: money(session.productsSubtotalExclTaxAmount) },
    { label: labels.tax, amount: money(session.productsTaxAmount) },
    { label: labels.productsInclTax, amount: money(session.productsSubtotalInclTaxAmount) },
    { label: labels.shipping, amount: money(session.totalShippingFeeAmount) },
    { label: labels.grandTotal, amount: money(session.grandTotalAmount), emphasis: true },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label={labels.quoteLabel}
        className="rounded-lg border border-line-strong bg-surface p-4"
      >
        <h2 className="mb-3 text-base font-semibold text-content">{labels.quoteLabel}</h2>

        <dl className="flex flex-col gap-2">
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
                {line.amount ?? (
                  <span className="text-content-muted">{labels.amountUnavailable}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label={labels.destinationsLabel}>
        <h2 className="mb-3 text-base font-semibold text-content">{labels.destinationsLabel}</h2>

        <ul className="flex list-none flex-col gap-3">
          {session.allocations.map((allocation) => {
            const shipping = formatMoney(
              allocation.shippingFeeAmount,
              session.currency,
              locale
            );
            return (
              <li
                key={allocation.companyLocationId}
                className="rounded-lg border border-line bg-surface p-3"
              >
                <p className="text-sm font-medium text-content">{allocation.locationName}</p>
                <p className="text-sm text-content-muted">
                  {localized(locale, allocation.cityNameAr, allocation.cityNameEn)} ·{" "}
                  {allocation.address}
                </p>
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
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
                      {shipping ?? (
                        <span className="text-content-muted">{labels.amountUnavailable}</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
