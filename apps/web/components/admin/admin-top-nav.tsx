"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FolderTabNav } from "@/components/portal/folder-tab-nav";
import type { NavRowItem } from "@/components/portal/nav-row";
import type { PortalTopNavLabels } from "@/components/portal/portal-top-nav";
import {
  CONTROL_PANEL_GROUPS,
  CONTROL_PANEL_HOME,
  CONTROL_PANEL_MAP,
} from "./control-panel-nav";

/**
 * THE CONSOLE'S NAVIGATION, IN THE PLATFORM'S OWN SHAPE.
 *
 * «بالنسبة للوحة الإدارة اعتمدها مع الواجهات الثلاث في التصميم.»
 *
 * THE SECTIONS ARE THE ROW, NOT THE PAGES. Twenty-one screens in one
 * horizontal line is a line nobody can scan: reaching «سجل التدقيق»
 * would mean sliding past twenty names, and the wave — which says where
 * you are by moving between names — has nothing legible to move
 * between. Six sections and the dashboard fit on one line at any width
 * the console is used at, and each opens its screens in the panel every
 * other row on this platform already opens.
 *
 * SO THE STRUCTURE THE CONSOLE NEEDS SURVIVES the change of clothes.
 * What it loses is the navy bar it stood in, its own disclosure code,
 * and the drawer that replaced it below `lg`.
 *
 * AND NOTHING POPS OUT OF IT — «يُلغى الإطار المنبثق». Pressing a
 * section opens its first screen, and that screen's own section draws
 * a row of its screens under the rule — see `AdminSectionRow`. A
 * floating frame had to be measured, clamped, portalled past two
 * clipping boxes and closed four ways, and it covered the page it was
 * opening.
 *
 * WHICH SECTION IS OPEN is answered by the ROW, from the address: every
 * section's `href` is its first screen, and the longest href that
 * prefixes the path wins. A reader on `/admin/invoicing` is inside
 * «المالية» because that section's first screen is `/admin/settlements`
 * — which does NOT prefix it. So the answer is handed in rather than
 * left to the prefix rule; see `activeKey`.
 */
export function AdminTopNav({
  basePath,
  labels,
  brand,
  controls,
  mobileControls,
  bell,
  pathname: given,
}: {
  basePath: string;
  labels: PortalTopNavLabels;
  /** The platform's mark, already rendered. */
  brand?: ReactNode;
  /** The language and the way out — see `RowControls`. */
  controls?: ReactNode;
  /** A SECOND instance for the narrow row, never the wide row's node. */
  mobileControls?: ReactNode;
  bell?: ReactNode;
  /** The path, when a caller already holds it. It reads its own otherwise. */
  pathname?: string;
}) {
  const read = usePathname();
  const pathname = given ?? read;

  const hrefFor = (segment: string) =>
    segment ? `${basePath}/${segment}` : basePath;

  /**
   * WHICH SECTION THE OPEN SCREEN BELONGS TO.
   *
   * ASKED OF THE MAP, not of the path. A section's own href is its
   * FIRST screen, so a prefix test would light «المالية» only while
   * `/admin/settlements` was open and light nothing on the two screens
   * beside it. The map already knows which section holds which screen.
   */
  const openSection =
    CONTROL_PANEL_GROUPS.find((group) =>
      group.pages.some(
        (page) =>
          pathname === hrefFor(page.segment) ||
          pathname.startsWith(`${hrefFor(page.segment)}/`),
      ),
    )?.key ?? (pathname === basePath ? CONTROL_PANEL_HOME.key : null);

  const items: NavRowItem[] = [
    {
      key: CONTROL_PANEL_HOME.key,
      href: basePath,
      label: labels.pageNames[CONTROL_PANEL_HOME.key] ?? CONTROL_PANEL_HOME.key,
    },
    ...CONTROL_PANEL_GROUPS.map((group) => ({
      key: group.key,
      // A SECTION IS ITS FIRST SCREEN. It is a heading with no route
      // of its own — `/admin/market` has never been one — so the name
      // leads where the section begins.
      href: hrefFor(group.pages[0].segment),
      label: labels.groupNames[group.key] ?? group.key,

    })),
  ];

  return (
    <FolderTabNav
      portal="admin"
      basePath={basePath}
      map={CONTROL_PANEL_MAP}
      labels={labels}
      // THE ROW IS HANDED IN WHOLE. The derived one is built from
      // `tabOrder`, which is a list of PAGES; this front's row is a
      // list of SECTIONS, and no page map can say that.
      tabOrder={[]}
      navRowItems={items}
      navRowActiveKey={openSection}
      brand={brand}
      controls={controls}
      mobileControls={mobileControls}
      bell={bell}
      pathname={pathname}
    />
  );
}
