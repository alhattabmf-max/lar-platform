"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NavRow, type NavRowItem } from "@/components/portal/nav-row";
import type { PortalTopNavLabels } from "@/components/portal/portal-top-nav";
import { CONTROL_PANEL_GROUPS } from "./control-panel-nav";

/**
 * The id of the slot in this row that a screen may render into.
 *
 * ONE NAME, SHARED, so the row that offers it and the toolbar that
 * fills it cannot drift apart on the spelling — the failure would be
 * silent: a button that simply never appears.
 */
export const SECTION_ROW_SLOT = "admin-section-row-slot";

/**
 * THE OPEN SECTION'S SCREENS, UNDER THE RULE.
 *
 * «عناوين التوجيه في الشريط العلوي تنبثق منها عناوين الصفحات — الأفضل
 *  أنها تنزل تحت الشريط البرتقالي عند الضغط على اسم القسم… يُلغى
 *  الإطار المنبثق.»
 *
 * NO PANEL AND NO STATE. A floating frame had to be measured, clamped,
 * portalled past two clipping boxes and closed four different ways —
 * and it covered the page it was opening. This is a ROW, in the page,
 * exactly where the market's categories sit, and it is derived from the
 * ADDRESS rather than from a press:
 *
 *   pressing a section opens its first screen, and that screen's own
 *   section is what draws this row.
 *
 * SO THERE IS NOTHING TO SYNCHRONISE. Back and forward work, a link
 * shared into a section arrives with the row already correct, and no
 * two components can disagree about which section is open.
 *
 * IT DRAWS NOTHING ON THE DASHBOARD — that page belongs to no section,
 * and an empty row would be a rule with a gap under it.
 */
export function AdminSectionRow({
  basePath,
  labels,
  action,
  pathname: given,
}: {
  basePath: string;
  labels: PortalTopNavLabels;
  /**
   * THE CONSOLE'S HELP, level with the screens — «أيقونة المساعدة
   *  حطها في نفس الصفحة موازية لأسماء الصفحات».
   *
   * It had a row of its own between the rule and the page, holding
   * one button.
   */
  action?: ReactNode;
  /** The path, when a caller already holds it. It reads its own otherwise. */
  pathname?: string;
}) {
  const read = usePathname();
  const pathname = given ?? read;

  const hrefFor = (segment: string) =>
    segment ? `${basePath}/${segment}` : basePath;

  const section = CONTROL_PANEL_GROUPS.find((group) =>
    group.pages.some(
      (page) =>
        pathname === hrefFor(page.segment) ||
        pathname.startsWith(`${hrefFor(page.segment)}/`),
    ),
  );

  // THE DASHBOARD BELONGS TO NO SECTION, and an empty row would be
  // a rule with a gap under it — unless the help is standing in it,
  // which it is on every screen.
  if (!section && !action) return null;

  const items: NavRowItem[] =
    section?.pages.map((page) => ({
      key: page.key,
      href: hrefFor(page.segment),
      label: labels.pageNames[page.key] ?? page.key,
    })) ?? [];

  /**
   * WHICH SCREEN IS OPEN, and a record under it counts as its screen.
   *
   * The row's own rule — the longest href that prefixes the path —
   * gets this right on its own, so nothing is handed in. `/companies`
   * and `/companies/abc` both resolve to «الشركات», and no other
   * screen's href prefixes either.
   */
  return (
    <div data-testid="admin-section-row">
      {/* NO COLOUR ON THE SCROLLER OR IN IT. A block inside a
          horizontal scroller takes the SCROLLER'S width, not the
          content's — measured once at 393 against 837 of names, which
          left 120 pixels of bare ground under white text. */}
      <div className="no-scrollbar overflow-x-auto">
        <NavRow
          items={items}
          label={labels.navLabel}
          tone="band"
          pathname={pathname}
          idPrefix="admin-section"
          action={
            <span className="flex items-center gap-2">
              {/* WHERE A SCREEN'S OWN CONTROL STANDS — «خلّ زر البحث
                  يطلع لصف اللي تحت الشريط بجانب علامة المساعدة».

                  AN EMPTY NODE, filled from the page. This row is
                  drawn by the console's chrome and the search button
                  belongs to whichever screen is open, so the two
                  cannot be written in one place: the row offers the
                  slot, and `ListToolbar` puts its opener in it with a
                  portal once the browser has both.

                  BEFORE THE HELP, so the thing a reader uses on every
                  visit sits where the eye lands first and the thing
                  they use once stays at the end. */}
              <span id={SECTION_ROW_SLOT} className="contents" />
              {action}
            </span>
          }
        />
      </div>
    </div>
  );
}
