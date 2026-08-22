import Link from "next/link";
import {
  OPPORTUNITY_SORTS,
  TAXONOMY_FILTER_INCLUDES_DESCENDANTS,
  type CityItem,
  type OpportunitySort,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import {
  hasActiveFilters,
  PUBLIC_OPPORTUNITIES_PATH,
  type MarketplaceQuery,
} from "@/lib/marketplace-query";
import { Select } from "@/components/ui/select";
import { Button, buttonClasses } from "@/components/ui/button";
import type { TaxonomyOption } from "@/lib/taxonomy-tree";

/**
 * City / category / sort filters.
 *
 * A plain `<form method="get">` with NO client JavaScript, for two
 * reasons that both matter more than the extra click:
 *
 *  - Auto-submitting a `<select>` on change is hostile to keyboard
 *    users, because arrow keys move through the options one at a time
 *    and each step would fire a navigation. An explicit Apply button is
 *    the accessible behaviour, not a compromise.
 *  - A GET form works with JavaScript disabled and produces exactly the
 *    same URL the links elsewhere produce, so there is one filtering
 *    mechanism rather than two that can disagree.
 *
 * Field names match the query parameters the page parses, so the
 * browser's own serialisation IS the URL builder. Submitting drops
 * `page`, which resets to the first page — the correct behaviour when
 * the result set changes underneath you.
 *
 * Nothing here filters anything. Every value round-trips to the API,
 * which applies it in SQL; a client-side filter over one page of a
 * paginated list would hide matches on every other page.
 */
export interface OpportunityFiltersLabels {
  regionLabel: string;
  cityLabel: string;
  anyCity: string;
  categoryLabel: string;
  anyCategory: string;
  /** Shown only while the API applies exact matching — see below. */
  categoryExactMatchHint: string;
  sortLabel: string;
  sortOptions: Record<OpportunitySort, string>;
  apply: string;
  clear: string;
}

export interface OpportunityFiltersProps {
  locale: AppLocale;
  query: MarketplaceQuery;
  cities: readonly CityItem[];
  taxonomyOptions: readonly TaxonomyOption[];
  labels: OpportunityFiltersLabels;
  /** Which listing the form submits back to. Defaults to the public one. */
  basePath?: string;
}

export function OpportunityFilters({
  locale,
  query,
  cities,
  taxonomyOptions,
  labels,
  basePath = PUBLIC_OPPORTUNITIES_PATH,
}: OpportunityFiltersProps) {
  return (
    <form
      method="get"
      action={`/${locale}/${basePath}`}
      aria-label={labels.regionLabel}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-city" className="block text-sm font-medium text-content">
            {labels.cityLabel}
          </label>
          <Select id="filter-city" name="cityId" defaultValue={query.cityId ?? ""}>
            <option value="">{labels.anyCity}</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {localized(locale, city.nameAr, city.nameEn)}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-category" className="block text-sm font-medium text-content">
            {labels.categoryLabel}
          </label>
          <Select
            id="filter-category"
            name="taxonomyNodeId"
            defaultValue={query.taxonomyNodeId ?? ""}
            describedById={
              TAXONOMY_FILTER_INCLUDES_DESCENDANTS ? undefined : "filter-category-hint"
            }
          >
            <option value="">{labels.anyCategory}</option>
            {/* Every active node is offered, including parents: a
                product may be filed directly under an intermediate
                category, so hiding parents would make those products
                unreachable. The option text is the full path, which is
                what makes a flat <select> readable as a hierarchy. */}
            {taxonomyOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.path}
              </option>
            ))}
          </Select>

          {/* Read from the contract, not asserted by hand: the API
              matches the selected node EXACTLY, so choosing a parent
              does NOT include its subcategories. Saying so is the
              difference between a filter and a trap. If descendant
              matching ever ships, the constant flips and this
              disappears on its own. */}
          {TAXONOMY_FILTER_INCLUDES_DESCENDANTS ? null : (
            <p id="filter-category-hint" className="text-xs text-content-muted">
              {labels.categoryExactMatchHint}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-sort" className="block text-sm font-medium text-content">
            {labels.sortLabel}
          </label>
          <Select id="filter-sort" name="sort" defaultValue={query.sort}>
            {OPPORTUNITY_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {labels.sortOptions[sort]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm">
          {labels.apply}
        </Button>

        {hasActiveFilters(query) ? (
          <Link
            href={`/${locale}/${basePath}`}
            className={buttonClasses("ghost", "sm")}
          >
            {labels.clear}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
