import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { loadTaxonomy } from "@/lib/marketplace-data";
import { getSiteContent } from "@/lib/site-content";
import { buildCategoryTree } from "@/components/shell/category-tree";
import { CategoryNav } from "@/components/shell/category-nav";

/**
 * WHAT THE MARKET TAB'S STRIP CARRIES.
 *
 * «وفي شريط السوق حط التصنيفات وعرض الكل» — and, for the buyer,
 * «وأضف في لسان السوق في صفحة المشتري التصنيفات». The categories used
 * to be a white band of their own under the platform bar, on every
 * public page including the ones with nothing to browse. They belong to
 * the market, so they live in the market tab's strip.
 *
 * THE SAME COMPONENT FOR BOTH FRONTS. A visitor and a signed-in buyer
 * browse the same catalogue; the only thing that differs is the base
 * path their links are built from, so that is the only prop.
 *
 * THE SEARCH ICON IS NOT IN HERE. It stands at the FAR END of the same
 * strip — «وخل الأيقونة في الجهة المقابلة من اللسان» — so it is a
 * separate element the chrome places opposite this one. See
 * `MarketSearch`.
 *
 * A SERVER COMPONENT, and it has to be: it reads the taxonomy and the
 * operator's chosen roots. The chrome that places it is a client
 * component, so this arrives already rendered — an element, never a
 * function that makes one.
 */
export async function MarketStrip({
  locale,
  basePath,
}: {
  locale: AppLocale;
  /** Where this front's market lives: `/ar-SA` or `/ar-SA/trader`. */
  basePath: string;
}) {
  const t = await getTranslations({ locale, namespace: "shell" });

  // Shares one fetch each with the page body through React's request
  // cache, so this costs no extra round trip.
  const [taxonomy, content] = await Promise.all([loadTaxonomy(), getSiteContent()]);

  const market = `${basePath}/opportunities`;

  const categories = taxonomy.ok
    ? buildCategoryTree(
        taxonomy.data,
        content.headerNav.map((item) => item.taxonomyNodeId),
        locale,
        // The href is CONSTRUCTED from a taxonomy id. The stored value
        // is an id and nothing else, so there is no destination here
        // that anyone typed and nothing to allowlist.
        (id) => `${market}?taxonomyNodeId=${encodeURIComponent(id)}`,
      )
    : [];

  return (
    <div className="flex min-w-0 items-center">
      <CategoryNav
        items={categories}
        tone="strip"
        viewAllLabel={t("nav.viewAll")}
        viewAllHref={market}
        allInCategoryLabel={t("nav.allInCategory")}
        navLabel={t("nav.label")}
        openTemplate={t("nav.openCategory", { name: "{name}" })}
      />

    </div>
  );
}
