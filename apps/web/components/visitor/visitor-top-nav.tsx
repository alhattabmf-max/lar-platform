"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FolderTabNav } from "@/components/portal/folder-tab-nav";
import type { PortalNavMap } from "@/components/portal/portal-nav";
import type { PortalTopNavLabels } from "@/components/portal/portal-top-nav";
import type { NavRowItem } from "@/components/portal/nav-row";

/**
 * THE VISITOR'S NAVIGATION — two tabs, and the market's own strip.
 *
 * «وصمّم واجهة الزائر بنفس التصميم اللي اعتمدناه لواجهة المشتري
 * والمورد، وحط الألسنة عبارة عن الرئيسية والسوق فقط.» So the drawing is
 * `FolderTabNav`, the same file the other two rows are drawn by, and
 * what this contributes is which two pages are tabs and what the market
 * tab carries under it.
 *
 * THE STRIP IS THE MARKET'S ALONE. «وفي شريط السوق حط التصنيفات وعرض
 * الكل» — so the categories are drawn on the market tab and nowhere
 * else. On the home tab the strip is the sheet's top edge and nothing
 * more, which is what it is everywhere else in the platform.
 */
export const VISITOR_TAB_ORDER = ["home", "market"] as const;

export function VisitorTopNav({
  basePath,
  map,
  labels,
  brand,
  controls,
  pathname: given,
  searchLabels,
  drawerExtra,
  mobileControls,
  navRowItems,
}: {
  basePath: string;
  map: PortalNavMap;
  labels: PortalTopNavLabels;
  /** The path, when a caller already holds it. It reads its own otherwise. */
  /**
   * THE TENANT'S MARK, already rendered, standing before the first tab.
   * «شِل الشعار من الشريط العلوي وحطّه قبل لسان الرئيسية».
   */
  brand?: ReactNode;
  /**
   * THE LANGUAGE AND THE WAY IN OR OUT, already rendered — see
   * `RowControls`. This row is the front's top bar now.
   */
  controls?: ReactNode;
  pathname?: string;
  /**
   * THE SEARCH FIELD, already rendered — see `PortalSearch`. It is
   * built on the server because its words are translated there.
   */
  /** The search field's words and destination - see FolderTabNav. */
  searchLabels?: {
    action: string;
    placeholder: string;
    label: string;
    submitLabel: string;
  };
  /** The way into the market, already rendered - see PortalMarketLink. */
  drawerSearch?: ReactNode;
  drawerExtra?: ReactNode;
  /** The destinations of the narrow row — see `FolderTabNav`. */
  navRowItems?: readonly NavRowItem[];
  /**
   * THE LANGUAGE AND THE WAY IN, FOR THE NARROW ROW — a SECOND
   * `RowControls`, never the wide row's node. See `FolderTabNav`.
   */
  mobileControls?: ReactNode;

}) {
  const read = usePathname();
  const pathname = given ?? read;


  return (
    <FolderTabNav
      portal="visitor"
      basePath={basePath}
      map={map}
      labels={labels}
      tabOrder={VISITOR_TAB_ORDER}
      brand={brand}
      controls={controls}
      searchLabels={searchLabels}
      drawerExtra={drawerExtra}
      mobileControls={mobileControls}
      navRowItems={navRowItems}
      pathname={pathname}
    />
  );
}
