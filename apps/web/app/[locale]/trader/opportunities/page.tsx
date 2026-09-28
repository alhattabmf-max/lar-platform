import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import {
  parseMarketplaceQuery,
  hasActiveFilters,
  type MarketplaceQuery,
} from "@/lib/marketplace-query";
import { loadCities, loadRegions, loadTaxonomy } from "@/lib/marketplace-data";
import { loadTraderOpportunities } from "@/lib/trader-data";
import { buildTaxonomyOptions } from "@/lib/taxonomy-tree";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { OpportunityFilters } from "@/components/opportunities/opportunity-filters";
import { OpportunityPagination } from "@/components/opportunities/opportunity-pagination";
import { OpportunityCard } from "@/components/opportunities/opportunity-card";
import { offerCardLabels } from "@/lib/offer-labels";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.opportunities");


/**
 * The marketplace as a signed-in trader sees it: the same catalogue,
 * with commercial terms.
 *
 * It reuses the public filters and pager rather than growing a second
 * query vocabulary — `/trader/opportunities/active` takes the very same
 * parameters, so a URL means the same thing on either listing and the
 * two cannot drift apart in what a filter does.
 *
 * THE CARD IS THE SAME CARD THE FRONT DOOR DRAWS — «لا أريد اختلافًا
 * في شكل بطاقة المنتج في الرئيسية وفي السوق أو أي صفحة تحمل منتجًا
 * معروضًا».
 *
 * IT USED TO BE ITS OWN COMPONENT, kept separate so that a `showTerms`
 * flag could never print a price on the anonymous marketplace. That
 * reasoning is spent: the public contract carries the price and the
 * quantities BY DECISION, and the public card shows them. The one
 * figure this card had that the public one does not is the shipping
 * CITY — and the detail page is where that belongs, which is where it
 * still is.
 *
 * SO THERE IS NOTHING LEFT FOR A SECOND COMPONENT TO PROTECT, and two
 * components drawing the same offer is how the same product came to
 * look like two different things either side of signing in.
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
      {/* FIRST, AND TOUCHING THE STRIP — «الصقه في الشريط اللي
          فوقه». It stood third, under the heading and a banner slot,
          which is the gap the owner measured. Being first in the body
          IS being under the tab strip; nothing else may come between. */}
      <FiltersRegion locale={appLocale} query={query} />

      <header className="flex flex-col gap-2">
        {/* THE TAB ABOVE IS THIS PAGE'S TITLE — «ألغِ التسمية المكررة مثل
              ما سوّينا في صفحة المورد». The heading stays for the document
              outline and for anyone reading by structure; a tab is a link
              and can never stand in for one. */}
          <h1 className="sr-only">{t("title")}</h1>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <ResultsRegion locale={appLocale} query={query} />
      </Suspense>
    </div>
  );
}

async function FiltersRegion({ locale, query }: { locale: AppLocale; query: MarketplaceQuery }) {
  const t = await getTranslations({ locale, namespace: "marketplace" });
  const states = await getTranslations({ locale, namespace: "states" });

  // BOTH LISTS. The region is the place filter; the cities are the
  // refinement offered beneath whichever region is chosen.
  const [regions, cities, taxonomy] = await Promise.all([
    loadRegions(),
    loadCities(),
    loadTaxonomy(),
  ]);

  // Reference data failing costs the filters, not the listing.
  if (!regions.ok || !cities.ok || !taxonomy.ok) {
    const error = !regions.ok
      ? regions.error
      : !cities.ok
        ? cities.error
        : !taxonomy.ok
          ? taxonomy.error
          : null;
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
      regions={regions.data}
      cities={cities.data}
      taxonomyOptions={buildTaxonomyOptions(taxonomy.data, locale)}
      basePath={TRADER_OPPORTUNITIES_PATH}
      labels={{
        formLabel: t("filters.regionLabel"),
        regionLabel: t("filters.region"),
        anyRegion: t("filters.anyRegion"),
        cityLabel: t("filters.city"),
        anyCity: t("filters.anyCity"),
        categoryLabel: t("filters.category"),
        anyCategory: t("filters.anyCategory"),
        anyBranch: t("filters.anyBranch"),
        categoryExactMatchHint: t("filters.categoryExactMatchHint"),
        sortLabel: t("filters.sort"),
        sortOptions: {
          NEWEST: t("sort.newest"),
          ENDING_SOON: t("sort.endingSoon"),
        },
        apply: t("filters.apply"),
        clear: t("filters.clear"),
        showResults: t("filters.show"),
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

      {/* THREE TO A ROW WHERE THERE IS ROOM — «أحتاج أقلّل بعض
          المعلومات عشان يصير الصف يأخذ ثلاث بطاقات». The same grid the
          front door and the public market use, because it is the same
          card. */}
      <ul className="grid list-none grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {items.map((opportunity) => (
          <li key={opportunity.id}>
            <OpportunityCard
              opportunity={opportunity}
              locale={locale}
              labels={offerCardLabels(marketplace, opportunity, locale)}
              // THE BUYER STAYS IN THE BUYER PORTAL. Same card, same
              // labels, its own detail page.
              detailBasePath={`/${locale}/trader/opportunities`}
            />
          </li>
        ))}
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
