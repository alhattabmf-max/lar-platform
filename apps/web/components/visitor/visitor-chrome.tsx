"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PortalChrome } from "@/components/portal/portal-chrome";
import { Boxes } from "lucide-react";
import type { PortalTopNavLabels } from "@/components/portal/portal-top-nav";
import { VISITOR_PORTAL_MAP } from "./visitor-portal-nav";
import { VisitorTopNav } from "./visitor-top-nav";

/**
 * The visitor's frame, with the visitor's map bound INSIDE the client
 * bundle.
 *
 * WHY THIS FILE EXISTS AT ALL. A nav map holds Lucide icons, and an
 * icon is a function. A Server Component cannot hand a function to a
 * Client Component — React refuses to serialise it — so a layout that
 * passed `map={VISITOR_PORTAL_MAP}` straight to the chrome produced a
 * 500 on every request. The map is imported HERE, on the client side of
 * the boundary, and never crosses it.
 *
 * THE FOOTER IS NOT IN HERE. It is the public site's own and the layout
 * keeps it below this frame: the portals have no footer, and putting
 * one in the shared chrome would give them one.
 */
export function VisitorChrome({
  basePath,
  nav,
  searchLabels,
  drawerExtra,
  mobileControls,
  categoryBand,
  controls,
  brand,
  children,
}: {
  basePath: string;
  nav: PortalTopNavLabels;
  /** The market tab's categories, already rendered — see `VisitorTopNav`. */
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
  /**
   * THE LANGUAGE AND THE WAY IN, FOR THE NARROW ROW — a SECOND
   * `RowControls`, never the wide row's node. See `FolderTabNav`.
   */
  mobileControls?: ReactNode;
  /** The categories, already built — see `CategoryBandSlot`. */
  categoryBand?: ReactNode;

  /**
   * THE LANGUAGE AND THE WAY OUT, already rendered — see
   * `RowControls`. The row of tabs is this front's top bar now.
   */
  controls?: ReactNode;
  /** The tenant's mark, already rendered, for the head of that row. */
  brand?: ReactNode;
  children: ReactNode;
}) {
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
      map={VISITOR_PORTAL_MAP}
      nav={nav}
      // NO CHROME BREADCRUMB. The public pages draw their own way back
      // where they need one, and a second trail above the first would be
      // two answers to one question.
      breadcrumbs={null}
      // THE PAGE IS A SHEET, and the tabs above belong to it — «صمّم
      // واجهة الزائر بنفس التصميم».
      mainSurface
      // THE CATEGORIES STAND IN THE PAGE NOW — see `PortalChrome`.
      //
      // AND ON THE MARKET ROUTE ALONE — «الرئيسية ما يجي تحتها
      //  تصنيفات، على طول بنر». `startsWith` and not `===`, so an
      // offer's own page keeps them: a reader who opened one offer
      // is still shopping.
      band={onMarket ? categoryBand : null}
      navSlot={
        <VisitorTopNav
          basePath={basePath}
          map={VISITOR_PORTAL_MAP}
          labels={nav}
          controls={controls}
          brand={brand}
          searchLabels={searchLabels}
          drawerExtra={drawerExtra}
          mobileControls={mobileControls}
          // THE VISITOR'S TWO DESTINATIONS — «بالنسبة لصفحة الزائر
          //  بنحط جميع المنتجات جنب الرئيسية».
          //
          // AND THAT SECOND NAME IS WHAT MAKES THE SIGNATURE
          // POSSIBLE HERE: a row of one has nowhere for the wave to
          // slide to.
          navRowItems={[
            { key: "home", href: basePath, label: nav.pageNames.home ?? "" },
            {
              key: "market",
              href: `${basePath}/opportunities`,
              // «السوق» AND NOT «جميع المنتجات» — «لأنها تعتبر مكرّرة:
              //  وحدة قسم والثانية تصنيف نفس الاسم». This is the PLACE;
              // the filter of the same name leads the categories below.
              label: nav.pageNames.market ?? "",
              icon: Boxes,
            },
          ]}
        />
      }
    >
      {children}
    </PortalChrome>
  );
}
