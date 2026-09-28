import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { loadTaxonomy } from "@/lib/marketplace-data";
import { getSiteContent } from "@/lib/site-content";
import { buildCategoryTree } from "@/components/shell/category-tree";
import { CategoryBand } from "./category-band";

/**
 * WHAT THE BAND CARRIES, read on the server.
 *
 * THE SAME TWO READS THE WIDE SCREEN'S STRIP MAKES — the operator's
 * chosen roots from `getSiteContent()` and the live names from
 * `loadTaxonomy()`, both wrapped in React's `cache`, so the strip and
 * this band are one pair of requests and not two.
 *
 * EVERY DESTINATION IS BUILT FROM A TAXONOMY ID. The stored value is an
 * id and never anything a person typed, so there is no address here to
 * allowlist.
 *
 * A FAILED READ DRAWS NOTHING AT ALL — no empty orange strip. The row
 * above it still reaches the whole listing, which is the one way in
 * that must never depend on the catalogue being fetchable.
 */
export async function CategoryBandSlot({
  locale,
  basePath,
}: {
  locale: AppLocale;
  /** `/ar-SA` for the visitor, `/ar-SA/trader` for the buyer. */
  basePath: string;
}) {
  const [t, filters, taxonomy, content] = await Promise.all([
    getTranslations({ locale, namespace: "shell.nav" }),
    getTranslations({ locale, namespace: "marketplace.filters" }),
    loadTaxonomy(),
    getSiteContent(),
  ]);

  if (!taxonomy.ok) return null;

  const market = `${basePath}/opportunities`;
  const roots = buildCategoryTree(
    taxonomy.data,
    content.headerNav.map((item: { taxonomyNodeId: string }) => item.taxonomyNodeId),
    locale,
    (id) => `${market}?taxonomyNodeId=${encodeURIComponent(id)}`,
  );

  if (roots.length === 0) return null;

  return (
    <CategoryBand
      label={t("viewAll")}
      allHref={market}
      allLabel={t("allInCategory")}
      // THE SAME WORDS THE FILTER USES for the same thing — a
      // category with no branch chosen. One name, two places.
      allBranchesLabel={filters("anyBranch")}
      categories={roots.map((node) => ({
        id: node.id,
        name: node.label,
        href: node.href,
        // THE BRANCHES COME FROM THE LIVE TAXONOMY, which is what
        // `buildCategoryTree` already reads for the wide screen's
        // strip — one tree, two rows, no second source to drift.
        children: node.children,
      }))}
    />
  );
}
