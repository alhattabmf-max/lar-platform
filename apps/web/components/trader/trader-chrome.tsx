"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PortalChrome } from "@/components/portal/portal-chrome";
import { PortalPageBar } from "@/components/portal/portal-page-bar";
import type { PortalTopNavLabels } from "@/components/portal/portal-top-nav";
import { TRADER_PORTAL_MAP } from "./trader-portal-nav";
import { TraderTopNav } from "./trader-top-nav";

import { traderBarLinks, type TraderBarLabels } from "./trader-bar-actions";

/**
 * The buyer's frame, with the buyer's map bound INSIDE the client bundle.
 *
 * WHY THIS FILE EXISTS AT ALL. A nav map holds Lucide icons, and an
 * icon is a function. A Server Component cannot hand a function to a
 * Client Component — React refuses to serialise it — so a layout that
 * passed `map={TRADER_PORTAL_MAP}` straight to the chrome produced a
 * 500 on every request with «Functions cannot be passed directly to
 * Client Components». Neither `tsc` nor `next build` catches it; only a
 * real request does.
 *
 * The map is therefore imported HERE, on the client side of the
 * boundary, and never crosses it. The layout passes strings and
 * elements only.
 *
 * IT IMPORTS ONE MAP AND ONLY ONE. A registry keyed by portal name
 * would put the console's destinations in the buyer's bundle; a file
 * per portal keeps each portal's links in its own.
 */
export function TraderChrome({
  basePath,
  nav,
  bell,
  searchLabels,
  drawerExtra,
  mobileControls,
  categoryBand,
  barLinkLabels,
  controls,
  brand,
  alert,
  children,
}: {
  basePath: string;
  nav: PortalTopNavLabels;
  /** The words for the links the strip carries — see `traderBarLinks`. */
  barLinkLabels?: TraderBarLabels;
  /** The bell, built by the layout — see `TraderTopNav`. */
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
  /** The way into the market, already rendered - see PortalMarketLink. */
  drawerSearch?: ReactNode;
  drawerExtra?: ReactNode;
  /**
   * THE LANGUAGE AND THE WAY IN, FOR THE NARROW ROW — a SECOND
   * `RowControls`, never the wide row's node. See `FolderTabNav`.
   */
  mobileControls?: ReactNode;
  /**
   * THE CATEGORIES, already built — see `CategoryBandSlot`.
   *
   * THE BUYER BROWSES, so the buyer has them; the supplier does not
   * — «كلٌّ يبحث في عالمه». They stand in the page, on the market
   * route only; see `PortalChrome`.
   */
  categoryBand?: ReactNode;
  /**
   * THE WORDS FOR THE BAR AT THE FOOT — strings, never a node,
   * because the icons beside them are functions and a function is
   * exactly what React will not serialise across the boundary.
   */

  /** The market tab's categories, already rendered — see `MarketStrip`. */
  /**
   * THE LANGUAGE AND THE WAY OUT, already rendered — see
   * `RowControls`. The row of tabs is this front's top bar now.
   */
  controls?: ReactNode;
  /** The tenant's mark, already rendered, for the head of that row. */
  brand?: ReactNode;
  /** «إجراء مطلوب», already rendered — it stands beside the bell. */
  alert?: ReactNode;
  children: ReactNode;
}) {
  // THE PATH THIS FRONT'S LINE IS BUILT FROM. It was read a level
  // down, in `TraderTopNav`, while the bar was part of the chrome.
  const pathname = usePathname();

  /**
   * WHETHER THE OPEN PAGE IS THE MARKET.
   *
   * ASKED HERE rather than in the shared chrome: the console hands in
   * a band too, and its rule is a different question entirely — which
   * SECTION is open. One condition up there could not have said both.
   *
   * `startsWith` AND NOT `===`, so an offer's own page keeps the
   * categories: a reader who opened one offer is still shopping.
   */
  const onMarket = pathname.startsWith(`${basePath}/opportunities`);

  return (
    <PortalChrome
      basePath={basePath}
      map={TRADER_PORTAL_MAP}
      nav={nav}
      // NO CHROME BREADCRUMB. The buyer's deep pages draw their own way
      // back, and a second trail above the first would be two answers
      // to one question.
      breadcrumbs={null}
      // THE PAGE IS A SHEET, and the tabs above belong to it — «اجعل
      // تصميم لوحة المشتري نفس لوحة المورد». The console passes
      // nothing and keeps the plain page it had.
      mainSurface
      // ITS OWN NAVIGATION — one row of file tabs, no panels to open
      // first. The console keeps the shared bar, and it keeps it
      // because this is a decision each portal takes in its own file.
      // THE CATEGORIES, ON THE MARKET ROUTE ALONE — «الرئيسية ما
      //  يجي تحتها تصنيفات». The buyer's own dashboard is not a
      // place to browse.
      band={onMarket ? categoryBand : null}
      // THE WAY BACK AND THE PAGE'S ONE ACTION, in the page rather
      // than in a bar above it — «أي معلومات كانت في الأشرطة السابقة
      //  تنزل في الصفحة». Built here because the ROUTES are this
      // front's own; the line itself is the platform's one component.
      pageBar={
        barLinkLabels ? (
          <PortalPageBar
            portal="trader"
            links={traderBarLinks(pathname, basePath, barLinkLabels)}
          />
        ) : null
      }
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
        <TraderTopNav
          basePath={basePath}
          map={TRADER_PORTAL_MAP}
          labels={nav}
          controls={controls}
          brand={brand}
          alert={alert}
          bell={bell}
          searchLabels={searchLabels}
          drawerExtra={drawerExtra}
          mobileControls={mobileControls}
        />
      }
    >
      {children}
    </PortalChrome>
  );
}
