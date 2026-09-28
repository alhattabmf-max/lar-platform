import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { OpportunitySort } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import {
  parseMarketplaceQuery,
  hasActiveFilters,
  type MarketplaceQuery,
} from "@/lib/marketplace-query";
import {
  loadCities,
  loadRegions,
  loadOpportunities,
  loadTaxonomy,
} from "@/lib/marketplace-data";
import { buildTaxonomyOptions, findTaxonomyOption } from "@/lib/taxonomy-tree";
import { localized } from "@/lib/localized";
import { offerCardLabels } from "@/lib/offer-labels";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { BannerSlot } from "@/components/banners/banner-slot";
import { OpportunityFilters } from "@/components/opportunities/opportunity-filters";
import { OpportunityPagination } from "@/components/opportunities/opportunity-pagination";
import { OpportunityCard } from "@/components/opportunities/opportunity-card";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("marketplace");


/**
 * The public marketplace.
 *
 * Filtering, sorting and pagination are all applied by the API in SQL;
 * this page only ever displays the page of results it was handed. There
 * is no client-side filtering anywhere, because narrowing one page of a
 * paginated list would silently hide every match on the other pages.
 *
 * The heading renders immediately and each async region streams in
 * behind its own Suspense boundary, so a slow catalogue read delays the
 * filters alone and a slow banner delays nothing at all. This is also
 * why there is no `loading.tsx`: a route-level fallback has no locale
 * to translate its label with, whereas these boundaries do.
 */
/**
 * Rendered per request, stated explicitly rather than inferred.
 *
 * This page's entire output depends on the query string, so serving a
 * prerendered shell for every `?cityId=…` would show unfiltered results
 * under a filtered URL — a silent wrong answer rather than a visible
 * failure. Reading `searchParams` already opts a route out of static
 * rendering, but the guarantee is too important to leave as a side
 * effect of how the body happens to be written.
 *
 * This does NOT disable the data cache: the reads in marketplace-data
 * set their own `revalidate` windows explicitly, and an explicit cache
 * option survives this setting.
 */
export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const query = parseMarketplaceQuery(await searchParams);

  const t = await getTranslations({
    locale: appLocale,
    namespace: "marketplace",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });

  return (
    <div className="flex flex-col gap-6">
      {/* FIRST, AND TOUCHING THE STRIP — «الصقه في الشريط اللي
          فوقه». It stood third, under the heading and a banner slot,
          which is the gap the owner measured. Being first in the body
          IS being under the tab strip; nothing else may come between. */}
      <FiltersRegion locale={appLocale} query={query} />

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>

      {/* A promotional strip must never hold up the listing. */}
      <Suspense fallback={null}>
        <BannerSlot
          placement="PUBLIC_OPPORTUNITIES"
          locale={appLocale}
          regionLabel={t("bannersLabel")}
        />
      </Suspense>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <ResultsRegion locale={appLocale} query={query} />
      </Suspense>
    </div>
  );
}

/**
 * The filter form renders even when the catalogue reads fail: with
 * empty option lists it simply offers fewer choices, which beats
 * removing controls a visitor may have arrived using.
 */
async function FiltersRegion({
  locale,
  query,
}: {
  locale: AppLocale;
  query: MarketplaceQuery;
}) {
  const t = await getTranslations({ locale, namespace: "marketplace" });

  // THE REGIONS, AND ONLY THE CHOSEN REGION'S CITIES.
  //
  // The city picker shows one region's cities. It used to receive every
  // active city on the platform and narrow them in the browser, which
  // put the whole list into the page twice — as markup and again in the
  // RSC payload — to display a handful. Picking a different region
  // fetches that region's cities from the filter itself.
  const [regions, cities, taxonomy] = await Promise.all([
    loadRegions(),
    query.regionId ? loadCities(query.regionId) : Promise.resolve({ ok: true as const, data: [] }),
    loadTaxonomy(),
  ]);
  const taxonomyOptions = taxonomy.ok
    ? buildTaxonomyOptions(taxonomy.data, locale)
    : [];

  /**
   * THE ROOTS, PLUS THE BRANCHES OF THE ONE THAT IS OPEN.
   *
   * The filter is two controls deep: a root category, and a branch
   * beneath whichever root is chosen. It used to receive the entire
   * tree as a prop and pick those two slices out of it in the browser —
   * so every category on the platform was serialised into the page
   * twice to render at most one root's children.
   *
   * The rest of the tree can never be rendered by this control, so it
   * does not travel.
   */
  const chosen = taxonomyOptions.find((option) => option.id === query.taxonomyNodeId);
  const openRootId = chosen ? (chosen.parentId ?? chosen.id) : null;
  const visibleTaxonomy = taxonomyOptions.filter(
    (option) => option.parentId === null || option.parentId === openRootId
  );

  const sortOptions: Record<OpportunitySort, string> = {
    NEWEST: t("sort.newest"),
    ENDING_SOON: t("sort.endingSoon"),
  };

  return (
    <OpportunityFilters
      locale={locale}
      query={query}
      regions={regions.ok ? regions.data : []}
      cities={cities.ok ? cities.data : []}
      taxonomyOptions={visibleTaxonomy}
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
        sortOptions,
        apply: t("filters.apply"),
        clear: t("filters.clear"),
        showResults: t("filters.show"),
      }}
    />
  );
}

async function ResultsRegion({
  locale,
  query,
}: {
  locale: AppLocale;
  query: MarketplaceQuery;
}) {
  const t = await getTranslations({ locale, namespace: "marketplace" });
  const states = await getTranslations({ locale, namespace: "states" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const results = await loadOpportunities(query);

  if (!results.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={results.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  // Resolving the active filters' names needs the catalogues, which the
  // filter region already fetched — the same revalidated cache entry
  // serves both, so this is not a second round trip.
  //
  // THE CITIES OF THE CHOSEN REGION ONLY, and only when a region is
  // chosen — this needs one name, not a catalogue.
  const [regions, cities, taxonomy] = await Promise.all([
    loadRegions(),
    query.regionId ? loadCities(query.regionId) : Promise.resolve({ ok: true as const, data: [] }),
    loadTaxonomy(),
  ]);
  // NAMED IN THE ORDER THEY NARROW: the region, then the city within
  // it. A summary that said only the city would leave a visitor
  // filtered by a region they cannot see stated anywhere.
  const activeRegion = regions.ok
    ? regions.data.find((r) => r.id === query.regionId)
    : undefined;
  const activeCity = cities.ok
    ? cities.data.find((c) => c.id === query.cityId)
    : undefined;
  const activeCategory = taxonomy.ok
    ? findTaxonomyOption(
        buildTaxonomyOptions(taxonomy.data, locale),
        query.taxonomyNodeId,
      )
    : null;

  const lastPage = Math.max(1, Math.ceil(results.data.total / query.pageSize));
  const filtered = hasActiveFilters(query);

  return (
    <>
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-content-muted"
      >
        {t("resultCount", { count: results.data.total })}
        {activeRegion
          ? ` · ${localized(locale, activeRegion.nameAr, activeRegion.nameEn)}`
          : ""}
        {activeCity
          ? ` · ${localized(locale, activeCity.nameAr, activeCity.nameEn)}`
          : ""}
        {activeCategory ? ` · ${activeCategory.path}` : ""}
      </p>

      {results.data.items.length === 0 ? (
        <EmptyState
          title={filtered ? t("emptyFiltered.title") : t("empty.title")}
          description={
            filtered ? t("emptyFiltered.description") : t("empty.description")
          }
          action={
            filtered ? (
              <ButtonLink
                href={`/${locale}/opportunities`}
                variant="ghost"
                size="sm"
              >
                {t("filters.clear")}
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        // THREE TO A ROW WHERE THERE IS ROOM — see `home-content`.
        <ul className="grid list-none grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {results.data.items.map((opportunity) => (
            <li key={opportunity.id}>
              <OpportunityCard
                opportunity={opportunity}
                locale={locale}
                labels={offerCardLabels(t, opportunity, locale)}
              />
            </li>
          ))}
        </ul>
      )}

      <OpportunityPagination
        locale={locale}
        query={query}
        total={results.data.total}
        labels={{
          navLabel: pagination("navLabel"),
          previous: pagination("previous"),
          next: pagination("next"),
          status: pagination("status", { page: query.page, lastPage }),
        }}
      />
    </>
  );
}
