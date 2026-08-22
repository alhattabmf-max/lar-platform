import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import {
  parseMarketplaceQuery,
  hasActiveFilters,
  type MarketplaceQuery,
} from "@/lib/marketplace-query";
import { loadCities, loadTaxonomy } from "@/lib/marketplace-data";
import { loadTraderOpportunities } from "@/lib/trader-data";
import { buildTaxonomyOptions } from "@/lib/taxonomy-tree";
import { localized } from "@/lib/localized";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { OpportunityFilters } from "@/components/opportunities/opportunity-filters";
import { OpportunityPagination } from "@/components/opportunities/opportunity-pagination";
import { TraderOpportunityCard } from "@/components/opportunities/trader-opportunity-card";

/**
 * The marketplace as a signed-in trader sees it: the same catalogue,
 * with commercial terms.
 *
 * It reuses the public filters and pager rather than growing a second
 * query vocabulary — `/trader/opportunities/active` takes the very same
 * parameters, so a URL means the same thing on either listing and the
 * two cannot drift apart in what a filter does.
 *
 * The card is a separate component, not the public one with a
 * `showTerms` flag. A flag is one wrong prop away from printing a
 * price on the anonymous marketplace.
 *
 * Filtering, sorting and pagination are applied by the API in SQL. No
 * client-side narrowing happens anywhere here: filtering one page of a
 * paginated list silently hides every match on the other pages.
 */
const TRADER_OPPORTUNITIES_PATH = "trader/opportunities";

export default async function TraderOpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  // The layout guards this segment; repeating it here means a refactor
  // that moves the page cannot silently unguard it.
  await requireRoleOrRedirect(appLocale, "TRADER");

  const query = parseMarketplaceQuery(await searchParams);

  const t = await getTranslations({ locale: appLocale, namespace: "trader.opportunities" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
        <FiltersRegion locale={appLocale} query={query} />
      </Suspense>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <ResultsRegion locale={appLocale} query={query} />
      </Suspense>
    </div>
  );
}

async function FiltersRegion({ locale, query }: { locale: AppLocale; query: MarketplaceQuery }) {
  const t = await getTranslations({ locale, namespace: "marketplace" });
  const states = await getTranslations({ locale, namespace: "states" });

  const [cities, taxonomy] = await Promise.all([loadCities(), loadTaxonomy()]);

  // Reference data failing costs the filters, not the listing.
  if (!cities.ok || !taxonomy.ok) {
    const error = !cities.ok ? cities.error : !taxonomy.ok ? taxonomy.error : null;
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={error?.requestId ?? null}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  return (
    <OpportunityFilters
      locale={locale}
      query={query}
      cities={cities.data}
      taxonomyOptions={buildTaxonomyOptions(taxonomy.data, locale)}
      basePath={TRADER_OPPORTUNITIES_PATH}
      labels={{
        regionLabel: t("filters.regionLabel"),
        cityLabel: t("filters.city"),
        anyCity: t("filters.anyCity"),
        categoryLabel: t("filters.category"),
        anyCategory: t("filters.anyCategory"),
        categoryExactMatchHint: t("filters.categoryExactMatchHint"),
        sortLabel: t("filters.sort"),
        sortOptions: {
          NEWEST: t("sort.newest"),
          ENDING_SOON: t("sort.endingSoon"),
        },
        apply: t("filters.apply"),
        clear: t("filters.clear"),
      }}
    />
  );
}

async function ResultsRegion({ locale, query }: { locale: AppLocale; query: MarketplaceQuery }) {
  const t = await getTranslations({ locale, namespace: "trader.opportunities" });
  const marketplace = await getTranslations({ locale, namespace: "marketplace" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadTraderOpportunities(query);

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

  const { items, total, page, pageSize } = result.data;

  if (items.length === 0) {
    return (
      <EmptyState
        title={t("emptyTitle")}
        description={
          hasActiveFilters(query) ? t("emptyFilteredDescription") : t("emptyDescription")
        }
      />
    );
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-content-muted">{t("resultCount", { count: total })}</p>

      <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((opportunity) => {
          const unit = localized(
            locale,
            opportunity.salesUnitNameAr,
            opportunity.salesUnitNameEn
          );
          return (
            <li key={opportunity.id}>
              <TraderOpportunityCard
                opportunity={opportunity}
                locale={locale}
                labels={{
                  unitPriceLabel: t("unitPrice"),
                  cityLabel: marketplace("card.city"),
                  soldLabel: t("sold"),
                  shareText: opportunity.shareQuantity
                    ? t("sharePurchaseStep", { quantity: opportunity.shareQuantity, unit })
                    : null,
                  unsoldLabel: t("unsold"),
                  closesLabel: marketplace("card.closes"),
                  scheduledBadge:
                    opportunity.status === "SCHEDULED" ? marketplace("card.scheduled") : null,
                  viewDetails: marketplace("card.viewDetails"),
                  priceUnavailable: t("priceUnavailable"),
                }}
              />
            </li>
          );
        })}
      </ul>

      <OpportunityPagination
        locale={locale}
        query={query}
        total={total}
        basePath={TRADER_OPPORTUNITIES_PATH}
        labels={{
          navLabel: pagination("navLabel"),
          previous: pagination("previous"),
          next: pagination("next"),
          status: pagination("status", { page, lastPage }),
        }}
      />
    </div>
  );
}
