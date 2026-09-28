import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { loadTaxonomy } from "@/lib/marketplace-data";
import { getSiteContent } from "@/lib/site-content";
import { buildCategoryTree } from "@/components/shell/category-tree";

/**
 * THE CATEGORIES, AS TILES THAT SWIPE.
 *
 * «قلنا التصنيفات مربعات وتُمرَّر، وليست مستطيلات فوق بعض.»
 *
 * THEY WERE A TWO-COLUMN GRID for one build and that was my misreading:
 * a grid stacked eight deep pushed the offers off the screen, which is
 * the opposite of what a category strip is for. A row costs ONE row of
 * height however many categories there are, and the eighth is one swipe
 * away rather than four scrolls.
 *
 * THE EDGE IS `border-s-4`, exactly as `LightCard` draws it on the
 * supplier's dashboard — «نفس نظام البطاقات العلوية في الصفحة الرئيسية
 * حقّت المورد» — on the LEADING side, so it is on the right in Arabic
 * and the left in English rather than frozen to one of them.
 *
 * THE COLOUR IS DECORATION AND SAYS SO. This platform has five identity
 * colours and there are seven roots, so two repeat. Nothing is encoded
 * in the colour — no category means "warning" — so a repeat costs
 * nothing, and inventing two hues outside the palette to avoid it would
 * cost the palette. The list is walked by index.
 *
 * NO PICTURES, AND THE NAME IS THE WHOLE TILE. «هل تستحق نضيف صور في
 * التصنيف أم يكفي الاسم» — `iconUrl` is on the contract and all
 * forty-three nodes are null, with no field in the console to fill it.
 * Seven concrete names read without help.
 *
 * NO NEGATIVE MARGIN ON THE STRIP. Running it to both screen edges with
 * its own start padding measured `scrollLeft: -12` in Arabic with the
 * first square jammed against the edge — a right-to-left overflow
 * container does not honour that padding as an initial offset.
 *
 * BELOW `lg` ONLY. The wide screen has these in the open tab's strip,
 * laid along a row where they cost no vertical space at all.
 */
const EDGES = [
  "border-s-primary",
  "border-s-secondary",
  "border-s-accent",
  "border-s-accent-interactive",
  "border-s-line-strong",
] as const;

/**
 * What every tile wears, whatever it points at.
 *
 * A RECTANGLE, NOT A SQUARE — «عرضها جميل ومناسب ولكن ارتفاعها مبالغ
 *  فيه… نخليها تحتوي فقط ثلاث أسطر فوق بعض، والحشو أقل قدر ممكن
 *  مناسب». It was 96 by 96 with the name floating in the middle of it,
 * so a two-word category paid for four lines of air it never used.
 *
 * THE HEIGHT IS THE NAME NOW: eight pixels above the first line and
 * eight below the last, capped at three lines. The widest of the seven
 * — «القوارير والعبوات السائلة» — takes two, so the row settles at
 * about 48 rather than 96.
 *
 * THREE LINES IS A CAP THE ROW CAN KEEP: the tiles are flex items in a
 * stretching row, so they all take the tallest one's height and the
 * strip stays one clean line whatever the operator names a category.
 *
 * AND A FLOOR UNDER IT ALL — the 44 a thumb is owed — because a
 * one-word category would otherwise come out 30 pixels tall.
 */
const TILE =
  "flex h-full min-h-nav w-24 shrink-0 items-center justify-center rounded-card border-s-4 bg-surface " +
  "px-2 py-2 text-center text-[11px] font-medium leading-tight shadow-card " +
  "hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export async function CategoryCards({
  locale,
  basePath,
}: {
  locale: AppLocale;
  /** `/ar-SA` for the visitor, `/ar-SA/trader` for the buyer. */
  basePath: string;
}) {
  const [t, taxonomy, content] = await Promise.all([
    getTranslations({ locale, namespace: "shell.nav" }),
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
    <nav aria-label={t("viewAll")} className="lg:hidden" data-testid="category-cards">
      <ul className="flex snap-x snap-mandatory list-none gap-3 overflow-x-auto pb-2">
        {roots.map((node, index) => (
          <li key={node.id} className="snap-start">
            <Link
              href={node.href}
              data-testid="category-card"
              className={`${TILE} text-content ${EDGES[index % EDGES.length]}`}
            >
              <span className="line-clamp-3">{node.label}</span>
            </Link>
          </li>
        ))}

        {/* AND THE WHOLE LIST, at the end of the row. A strip of seven
            categories with no way past them is a filter with no
            "off". */}
        <li className="snap-start">
          <Link
            href={market}
            data-testid="category-card-all"
            className={`${TILE} border-s-line text-content-muted`}
          >
            <span className="line-clamp-3">{t("allInCategory")}</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
