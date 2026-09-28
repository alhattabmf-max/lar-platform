"use client";

import { useQueryParam } from "@/lib/use-query-param";
import { NavRow, type NavRowChild, type NavRowItem } from "./nav-row";

/**
 * THE CATEGORIES, IN THE PAGE.
 *
 * «التصنيفات أو أي معلومات في الأشرطة تبقى في الصفحة بنفس خلفية الصفحة
 *  مع تغيير لون الكتابة للبرتقالي.»
 *
 * NO SURFACE OF ITS OWN. It stood on a band of the identity's orange
 * for a build, inside the sticky chrome; the band is gone and the ink
 * carries what it used to — `#b45309`, which measures 4.8:1 on the
 * page's ground.
 *
 * WHICH ONE IS OPEN COMES FROM THE ADDRESS, not from state: a category
 * is a filter on one listing route (`?taxonomyNodeId=`), so the row is
 * told rather than left to guess — and it follows the back button for
 * free, which state would not.
 *
 * `useQueryParam` AND NOT `useSearchParams`: the hook this app has for
 * exactly this reason. The Next one needs a boundary that this
 * application's production builds have stranded before — measured, four
 * builds in a row, with the finished markup left in a hidden div at the
 * end of `<body>`.
 *
 * AND THE BRANCHES ARE `NavRow`'S OWN BUSINESS. This component held the
 * open panel, its measuring, its clamping, its portal and its four ways
 * of closing for one build — until the console needed the same thing
 * for its sections and the choice was to copy all of it or move it. It
 * moved.
 */
export function CategoryBand({
  categories,
  label,
  allHref,
  allLabel,
  allBranchesLabel,
}: {
  categories: readonly {
    id: string;
    name: string;
    href: string;
    children?: readonly NavRowChild[];
  }[];
  /** The row's own accessible name. */
  label: string;
  /** Where «جميع المنتجات» points — the listing with no filter. */
  allHref: string;
  allLabel: string;
  /**
   * «كل الفروع» — the panel's own first row.
   *
   * NOT `allLabel`, which is «جميع المنتجات»: that is the whole
   * catalogue and it already leads the row. Inside one category's panel
   * the same words would read as a way out of the category rather than
   * as the category unnarrowed.
   */
  allBranchesLabel: string;
}) {
  const chosen = useQueryParam("taxonomyNodeId");

  // «جميع المنتجات» LEADS THE CATEGORIES, and is not a destination.
  //
  // IT WAS BOTH FOR ONE BUILD — a name in the row above AND the first
  // name here — «لأنها تعتبر مكرّرة: وحدة قسم والثانية تصنيف نفس
  //  الاسم». The row above says «السوق», which is the place; this
  // says «جميع المنتجات», which is the filter that is off.
  const items: NavRowItem[] = [
    { key: "", href: allHref, label: allLabel },
    ...categories.map((category) => ({
      key: category.id,
      href: category.href,
      label: category.name,
      children: category.children,
    })),
  ];

  return (
    <div data-testid="category-band">
      {/* NO COLOUR ON THE SCROLLER OR IN IT. The rule that cost us a
          build still applies to anything painted here in future: a
          block inside a horizontal scroller takes the SCROLLER'S width,
          not the content's, so a colour on the row measured 393 against
          837 of names and scrolling left 120 pixels bare. Paint the
          scroller, never the row. */}
      <div className="no-scrollbar overflow-x-auto">
        <NavRow
          items={items}
          label={label}
          tone="band"
          // AN ABSENT PARAMETER IS «جميع المنتجات» — the first item —
          // so an unfiltered listing lights it rather than nothing.
          activeKey={chosen ?? ""}
          idPrefix="category-band"
          panelLeadLabel={allBranchesLabel}
        />
      </div>
    </div>
  );
}
