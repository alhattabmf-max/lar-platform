import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadTraderLocations, loadTraderOpportunity } from "@/lib/trader-data";
import { loadCities } from "@/lib/marketplace-data";
import { localized, formatDateTime, daysUntil } from "@/lib/localized";
import { formatMoney, formatPercentage, formatQuantity } from "@/lib/money";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Fact, FactList } from "@/components/trader/account-panels";
import { PurchaseComposer } from "@/components/checkout/purchase-composer";
import type { SelectableLocation } from "@/lib/purchase-composer";

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

  const t = await getTranslations({ locale: appLocale, namespace: "trader.opportunities" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      {/* Rendered before the fetch resolves, so the way back exists
          even while the opportunity is still loading. */}
      <nav aria-label={t("detail.breadcrumbLabel")} className="text-sm">
        <Link
          href={`/${appLocale}/trader/opportunities`}
          className="text-secondary hover:opacity-90"
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

  const name = localized(locale, opportunity.productNameAr, opportunity.productNameEn);
  const description = localized(
    locale,
    opportunity.productDescriptionAr,
    opportunity.productDescriptionEn
  );
  const city = localized(
    locale,
    opportunity.fulfillmentCityNameAr,
    opportunity.fulfillmentCityNameEn
  );
  const region = localized(
    locale,
    opportunity.fulfillmentRegionNameAr,
    opportunity.fulfillmentRegionNameEn
  );
  const unit = localized(locale, opportunity.salesUnitNameAr, opportunity.salesUnitNameEn);

  const price = formatMoney(opportunity.unitPriceInclTaxAmount, opportunity.currency, locale);
  const sold = formatPercentage(opportunity.progressPercentage, locale);

  const opens = formatDateTime(opportunity.startAt, locale);
  const closes = formatDateTime(opportunity.endAt, locale);
  const days = daysUntil(opportunity.endAt);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start gap-3">
        <h1 className="flex-1 text-2xl font-semibold text-content">{name}</h1>
        {opportunity.status === "SCHEDULED" ? (
          <span className="rounded-md bg-warning-surface px-2 py-1 text-xs font-medium text-warning-text">
            {marketplace("card.scheduled")}
          </span>
        ) : null}
      </header>

      {description ? (
        // Plain text from the frozen approval snapshot, rendered as a
        // text node. Never dangerouslySetInnerHTML — forbidden across
        // this app by a repo-wide test.
        <p className="whitespace-pre-wrap text-sm text-content">{description}</p>
      ) : (
        <p className="text-sm text-content-muted">{marketplace("detail.noDescription")}</p>
      )}

      <section
        aria-label={t("detail.termsLabel")}
        className="flex flex-col gap-4 rounded-lg border border-line-strong bg-surface p-4"
      >
        <h2 className="text-base font-semibold text-content">{t("detail.termsLabel")}</h2>

        <p className="text-2xl font-semibold text-content">
          {/* A malformed amount renders as a stated absence, never as
              "0.00" — a zero is a claim about what something costs. */}
          {price ? (
            <>
              {price}
              {unit ? (
                <span className="text-base font-normal text-content-muted"> / {unit}</span>
              ) : null}
            </>
          ) : (
            <span className="text-base font-normal text-content-muted">
              {t("priceUnavailable")}
            </span>
          )}
        </p>
        <p className="text-sm text-content-muted">{t("detail.priceIncludesTax")}</p>

        <FactList>
          {opportunity.shareQuantity ? (
            <Fact
              label={t("detail.shareQuantity")}
              value={`${formatQuantity(opportunity.shareQuantity, locale)}${unit ? ` ${unit}` : ""}`}
            />
          ) : null}
          {sold ? <Fact label={t("sold")} value={sold} /> : null}
          <Fact
            label={t("unsold")}
            value={`${formatQuantity(opportunity.unsoldQuantity, locale)}${unit ? ` ${unit}` : ""}`}
          />
          <Fact
            label={t("detail.preparationTime")}
            value={t("detail.preparationDays", { days: opportunity.expectedPreparationDays })}
          />
        </FactList>

        {/* Both of these correct a reading the numbers above invite.
            `unsold` is arithmetic, not a reservation — checkout's lock
            is the only authority on what can be bought. And the sold
            percentage is a share of the supply cap: nothing unlocks at
            100%, because every paid order is fulfilled on its own. */}
        <p className="text-sm text-content-muted">{t("detail.unsoldCaveat")}</p>
        <p className="text-sm text-content-muted">{t("detail.progressCaveat")}</p>
      </section>

      <section aria-label={t("detail.deliveryLabel")}>
        <h2 className="mb-3 text-base font-semibold text-content">{t("detail.deliveryLabel")}</h2>
        <FactList>
          <Fact label={marketplace("card.city")} value={city} />
          {region ? <Fact label={marketplace("detail.region")} value={region} /> : null}
          {unit ? <Fact label={marketplace("card.unit")} value={unit} /> : null}
          {opens ? (
            <Fact
              label={marketplace("detail.opens")}
              value={<time dateTime={opportunity.startAt}>{opens}</time>}
            />
          ) : null}
          {closes ? (
            <Fact
              label={marketplace("card.closes")}
              value={<time dateTime={opportunity.endAt}>{closes}</time>}
            />
          ) : null}
        </FactList>
      </section>

      <p className="text-sm text-content-muted">
        {days === null ? marketplace("detail.closed") : marketplace("card.closesInDays", { days })}
      </p>

      <PurchaseRegion
        locale={locale}
        opportunityId={opportunity.id}
        shareQuantity={opportunity.shareQuantity}
        unsoldQuantity={opportunity.unsoldQuantity}
        salesUnitName={unit}
      />
    </div>
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

  const [locationsResult, cities] = await Promise.all([loadTraderLocations(), loadCities()]);

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

  const cityName = (cityId: string): string | null => {
    if (!cities.ok) return null;
    const city = cities.data.find((c) => c.id === cityId);
    return city ? localized(locale, city.nameAr, city.nameEn) : null;
  };

  const locations: SelectableLocation[] = locationsResult.data.map((location) => ({
    id: location.id,
    name: location.name,
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
    />
  );
}
