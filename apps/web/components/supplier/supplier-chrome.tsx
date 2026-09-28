"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PortalChrome } from "@/components/portal/portal-chrome";
import { PortalPageBar } from "@/components/portal/portal-page-bar";
import { supplierBarLinks } from "./supplier-bar-actions";

import type { PortalTopNavLabels } from "@/components/portal/portal-top-nav";
import { SUPPLIER_PORTAL_MAP } from "./supplier-portal-nav";
import { SupplierTopNav } from "./supplier-top-nav";
import type { SupplierBarLabels } from "./supplier-bar-actions";

/**
 * The supplier's frame, with the supplier's map bound INSIDE the client bundle.
 *
 * WHY THIS FILE EXISTS AT ALL. A nav map holds Lucide icons, and an
 * icon is a function. A Server Component cannot hand a function to a
 * Client Component — React refuses to serialise it — so a layout that
 * passed `map={SUPPLIER_PORTAL_MAP}` straight to the chrome produced a
 * 500 on every request with «Functions cannot be passed directly to
 * Client Components». Neither `tsc` nor `next build` catches it; only a
 * real request does.
 *
 * The map is therefore imported HERE, on the client side of the
 * boundary, and never crosses it. The layout passes strings and
 * elements only.
 *
 * IT IMPORTS ONE MAP AND ONLY ONE. A registry keyed by portal name
 * would put the console's destinations in the supplier's bundle; a file
 * per portal keeps each portal's links in its own.
 */
export function SupplierChrome({
  basePath,
  nav,
  bell,
  searchLabels,
  mobileControls,
  barLinkLabels,
  controls,
  brand,
  alert,
  children,
}: {
  basePath: string;
  nav: PortalTopNavLabels;
  /** The words for the links the strip carries — see `supplierBarLinks`. */
  barLinkLabels?: SupplierBarLabels;
  /** The bell, built by the layout — see `SupplierTopNav`. */
  bell?: ReactNode;
  /**
   * THE SEARCH FIELD, already rendered — see `PortalSearch`. It is
   * built by the layout because its words are translated on the server.
   */
  /** The search field's words and destination - see FolderTabNav. */
  searchLabels?: {
    action: string;
    placeholder: string;
    label: string;
    submitLabel: string;
  };
  /**
   * THE LANGUAGE AND THE WAY OUT, already rendered — see
   * `RowControls`. The row of tabs is this front's top bar now.
   */
  controls?: ReactNode;
  /** The tenant's mark, already rendered, for the head of that row. */
  brand?: ReactNode;
  /**
   * THE WORDS FOR THE BAR AT THE FOOT — strings, never a node,
   * because the icons beside them are functions and a function is
   * what React will not serialise across the boundary.
   */

  /**
   * THE BELL, THE ACCOUNT AND THE LANGUAGE, for the NARROW row — a
   * SECOND instance, never the wide row's nodes. One
   * server-rendered node placed twice inside a client component is
   * MOVED rather than copied.
   */
  mobileControls?: ReactNode;
  /** «إجراء مطلوب», already rendered — it stands beside the bell. */
  alert?: ReactNode;
  children: ReactNode;
}) {
  // THE PATH THIS FRONT'S LINE IS BUILT FROM. It was read a level
  // down, in `SupplierTopNav`, while the bar was part of the chrome.
  const pathname = usePathname();

  return (
    <PortalChrome
      basePath={basePath}
      map={SUPPLIER_PORTAL_MAP}
      nav={nav}
      // NO CHROME BREADCRUMB. The supplier's deep pages draw their own way
      // back, and a second trail above the first would be two answers
      // to one question.
      breadcrumbs={null}
      // THE PAGE IS A SHEET, and the tabs above belong to it — «شف كيف
      // تجي الصفحة كأن الموقع ملف». The other two portals pass nothing.
      mainSurface
      // THE WAY BACK AND THE PAGE'S ONE ACTION, in the page rather
      // than in a bar above it — «أي معلومات كانت في الأشرطة السابقة
      //  تنزل في الصفحة». Built here because the ROUTES are this
      // front's own; the line itself is the platform's one component.
      pageBar={
        barLinkLabels ? (
          <PortalPageBar
            portal="supplier"
            links={supplierBarLinks(pathname, basePath, barLinkLabels)}
          />
        ) : null
      }
      // ITS OWN NAVIGATION — sections above, file tabs beneath, as the
      // owner drew it. The console and the buyer keep the shared bar,
      // and they keep it because this is the only place that hands in
      // a different one.
      // NO SECOND SEARCH FIELD — «الشريط في المورد والمشتري شمل حقل
      //  بحث مع أننا غيّرنا مكانه فوق».
      //
      // `MarketBand` drew one under the row of names, left over from
      // the arrangement where the search belonged to the open tab's
      // strip. It belongs to the bar at the top now, on every page and
      // on every front — so this was the same field twice, and the
      // lower one was the taller and louder of the two.
      // NO BAR AT THE FOOT ANY MORE.
      //
      // IT HELD EXACTLY WHAT THE ROW OF NAMES NOW HOLDS. The rule is
      // the owner's own, written when «الرئيسية» was in both places:
      // «تكرار زر الرئيسية تحت وفوق» — and with the destinations
      // standing under the mark, every one of these was that same
      // repetition. Two navigations for one set of pages is also two
      // places a reader has to learn.
      //
      // THE COMPONENT AND ITS WORDS SURVIVE, so this is one prop to
      // put back if the bar is wanted again.
      navSlot={
        <SupplierTopNav
          basePath={basePath}
          map={SUPPLIER_PORTAL_MAP}
          labels={nav}
          controls={controls}
          brand={brand}
          alert={alert}
          bell={bell}
          searchLabels={searchLabels}
          mobileControls={mobileControls}
        />
      }
    >
      {children}
    </PortalChrome>
  );
}
