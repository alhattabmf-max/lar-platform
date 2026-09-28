"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PortalTopNav, type PortalTopNavLabels } from "./portal-top-nav";
import { Breadcrumbs } from "@/components/admin/breadcrumbs";
import {
  isPortalDetailPath,
  locatePortalPage,
  type PortalNavMap,
} from "./portal-nav";

/**
 * The interactive half of a portal's frame.
 *
 * The pieces that need state — a drawer that opens, a rail that
 * collapses, an account menu — share one owner, because the OPENER of
 * each has to be handed focus again when it closes and that only works
 * if one component holds the refs.
 *
 * Everything above it stays a Server Component: each portal's layout
 * reads its own session and translates its own strings, so this adds no
 * request of its own and carries no message catalogue into the bundle.
 *
 * WHAT IT DOES NOT DO is decide anything about a portal. The map, the
 * labels, the account menu and the sign-out control all arrive as
 * props from the layout that owns them. There is no branch in this file
 * on which portal is rendering, and therefore no way for one portal's
 * destination or action to appear in another's chrome.
 */

export interface PortalChromeProps {
  /** Where the portal lives, locale included: `/ar-SA/supplier`. */
  basePath: string;
  map: PortalNavMap;
  nav: PortalTopNavLabels;

  /**
   * THE PLATFORM'S ONE BAR, already rendered.
   *
   * A server component cannot be constructed inside this client one, so
   * the layout builds it and hands it down. It is still the single
   * shared bar every audience sees — the mark, the language, the bell
   * and the way out — not a second one this file assembles.
   */
  /**
   * OPTIONAL, because three of the four fronts no longer have one —
   * «احذف الشريط العلوي واعتبر الألسنة هي الشريط العلوي في الثلاث
   * واجهات». The console still renders it; the supplier, the buyer and
   * the visitor pass nothing and their row of tabs IS the bar.
   */
  topbar?: ReactNode;
  /**
   * Whether the chrome draws the trail.
   *
   * The console does, because its screens do not. The buyer's and the
   * supplier's pages draw their own way back where they need one, and a
   * second trail above the first would be two answers to one question.
   */
  breadcrumbs?: { label: string } | null;
  /**
   * A portal's OWN navigation, already built.
   *
   * The console and the buyer render the shared bar and pass nothing.
   * The supplier passes its own — the owner asked for a design isolated
   * from the other panels «حتى لو كانت المكونات مشتركة», and a portal
   * handing in its bar is what makes that structural: there is no flag
   * here to set from the wrong place and no default that can drift.
   *
   * AN ELEMENT, NOT A FUNCTION THAT MAKES ONE. This file is the client
   * side of the boundary and a Server Component fills its props; a
   * function-typed prop is exactly the shape React refuses to
   * serialise, and `server-client-boundary` fails the build for it
   * whether or not today's caller happens to be a client module. The
   * navigation reads the path itself, so it needs nothing handed to it.
   */
  navSlot?: ReactNode;
  /**
   * THE CATEGORIES, already built — see `CategoryBand`.
   *
   * IN THE PAGE, NOT IN THE CHROME. «بنلغي الشريط من جميع الصفحات
   *  ونكتفي بالشريط الخمسة بكسل، والتصنيفات أو أي معلومات في
   *  الأشرطة تبقى في الصفحة بنفس خلفية الصفحة.»
   *
   * SO IT IS OUTSIDE THE STICKY BOX and stands on the page's own
   * ground with no colour of its own. That is also what keeps a
   * phone's permanent chrome at two thin bars instead of the 153
   * pixels the stacked version measured.
   */
  band?: ReactNode;
  /**
   * THE PAGE'S OWN LINE — the way back, its one action, and
   * whatever a page hands up through `PORTAL_STRIP_SLOT`.
   *
   * IT USED TO BE CHROME. «ما أحتاج شريط، وأي معلومات كانت في
   *  الأشرطة السابقة تنزل في الصفحة» — so it is drawn inside the
   * sheet, first thing after the categories, on the page's own
   * white and in the identity's ink. Nothing it carries changed.
   */
  pageBar?: ReactNode;
  /**
   * THE DESTINATIONS AT THE FOOT OF THE SCREEN — see `BottomNav`.
   *
   * «شريطين ثابتين، واحد أعلى وواحد أسفل.» It is `fixed`, so the
   * page below carries padding for it rather than ending behind
   * it.
   */
  bottomNav?: ReactNode;
  /**
   * Whether the page's content stands on a SHEET.
   *
   * «شف كيف تجي الصفحة كأن الموقع ملف» — the supplier's portal is a
   * folder, its navigation is the tabs on that folder, and the page
   * under them is the sheet those tabs belong to. Without a sheet the
   * open tab has nothing to join, which is what made it read as
   * something floating above the page rather than part of it.
   *
   * The console and the buyer pass nothing and keep the plain page they
   * had, because this is the supplier's design and not the platform's —
   * «لا تعمّم التصميم إلا بموافقتي الصريحة».
   */
  mainSurface?: boolean;
  children: ReactNode;
}

export function PortalChrome({
  basePath,
  map,
  nav,
  topbar,
  breadcrumbs = null,
  navSlot,
  band,
  pageBar,
  bottomNav,
  mainSurface = false,
  children,
}: PortalChromeProps) {
  const pathname = usePathname();
  const here = locatePortalPage(map, pathname);
  // A record's own screen draws its own trail, because only it knows
  // the record's name and where the reader came from.
  const onDetailPage = isPortalDetailPath(map, pathname);

  return (
    // A COLUMN OF BANDS. The white bar, the navigation beneath it, then
    // the page. Nothing sits beside the content any more: a workspace
    // is where wide tables are read, and a rail took a fifth of the
    // width from every one of them on every screen.
    // THE GROUND IS THE PLATFORM'S OWN AGAIN — «رجّع خلفية الموقع
    // اللي عدّلناها لداكنة إلى لونها الأول».
    //
    // It was made navy so a white sheet would have an edge to show
    // against. The sheet no longer needs one: the open tab and the
    // strip below it are the platform's orange, and that is what parts
    // the page from what is behind it now. The token stays declared —
    // nothing else spends it — so putting it back is one word.
    //
    // WHAT THIS COSTS is the resting tabs' edge, and they are given
    // their own in `supplier-top-nav`: on navy a whisper of tint was
    // enough, on the page's own light it is not.
    //
    // THE ORIGINAL NOTE, kept because the trap it names is still there:
    //
    // A portal that stands its content on a SHEET needs something dark
    // behind it for that sheet to have an edge — but it cannot get it
    // by rebinding `--color-background`, which is the light surface
    // this system pairs `--color-text` with everywhere: a ghost
    // button's hover, a listbox's highlighted row, this card's own
    // footer. That rebinding turned every one of them into black on
    // navy. The dark colour is its own token, and it is spent here.
    <div
      className={
        "flex min-h-screen flex-col " +
        "bg-background"
      }
    >
      {/* THE TWO BARS STICK AS ONE PIECE, and that is what closes the
          gap.
          «فيه تشوه عند تمرير الصفحة للأعلى في الحافة السفلية للشريط
          العلوي… كأنه فراغ وتمر الصفحة من تحته». The tab row used to
          stick at a hand-written offset — the platform bar's height,
          copied as a number. But that bar is `min-h-nav`: a MINIMUM,
          not a fixed height. It grows with a taller logo, and at any
          device ratio that lands their shared edge on a fractional
          pixel the two round apart and the scrolling page shows through
          the slit.

          A NUMBER CANNOT BE KEPT IN STEP WITH A HEIGHT THAT VARIES, so
          there is no longer a number: one sticky box holds both bars at
          `top-0`, and whatever height the first one takes, the second
          begins exactly where it ends. The gap has nowhere to be.

          THE SUPPLIER'S FRAME ONLY. The console and the buyer keep the
          two independent bars they had — «لا تعمّم التصميم إلا
          بموافقتي الصريحة». */}
      {mainSurface ? (
        <div className="sticky top-0 z-50">
          {topbar}
          {navSlot}
        </div>
      ) : (
        <>
          {topbar}

          {navSlot ?? (
            <PortalTopNav
              basePath={basePath}
              map={map}
              labels={nav}
              pathname={pathname}
            />
          )}
        </>
      )}

      {/* THE CATEGORIES BELONG TO THE MARKET, AND TO NO OTHER PAGE.

          «الرئيسية ما يجي تحتها تصنيفات، على طول بنر» — and the
          orders, the follow-up and the company's own record are
          pages of work, not of shopping.

          ASKED OF THE PATH, not of the map. It used to be asked of
          the open TAB, back when the market hung under the home tab
          by `covers` and the categories were that tab's strip; that
          is exactly what put a row of categories on the buyer's own
          dashboard. The market has a name of its own on every front
          now, and the listing is one route — so the route is the
          honest question.

          `startsWith` AND NOT `===`, so an offer's own page keeps
          them: a reader who opened one offer is still shopping.

          AND IT IS DRAWN INSIDE THE SHEET — see below. */}

      {/* `topbarActions` DREW A ROW OF ITS OWN, and that row is gone.

          «ألغِ الشريط الفاصل بين الشريط البرتقالي والأقسام، وأيقونة
           المساعدة حطها في نفس الصفحة موازية لأسماء الصفحات.»

          IT HELD ONE BUTTON — the console's help — and cost a full
          line between the rule and the page, which read as a band
          parting them. What a front wants beside its own names now
          goes INTO the row that carries them. */}

      {/* FULL WIDTH, with the page's own padding and nothing reserved
          beside it. `min-w-0` so a wide table scrolls inside its own
          container rather than stretching the layout. */}
      <main
        id="main-content"
        tabIndex={-1}
        className={
          // NO SIDE PADDING BELOW `lg` WHEN THE PAGE IS A SHEET —
          // «ألغي الخلفية عشان نستفيد من المساحة، ونخلي اللون الأبيض حق
          //  بطاقة الصفحة هو اللون حق الخلفية وتكون هي الصفحة».
          //
          // TWO PADDINGS WERE PAYING FOR ONE MARGIN: this row and the
          // sheet inside it each inset 16, so a 390-pixel phone drew
          // its content in 326. The sheet keeps its own; this one
          // starts at `lg`, where a margin around the paper is the
          // point. Thirty-two pixels of width, on every page.
          (mainSurface ? "min-w-0 flex-1 lg:px-6" : "min-w-0 flex-1 px-4 lg:px-6") +
          // ROOM FOR THE BAR AT THE FOOT, and only where there is
          // one. It is `fixed`, so without this the last card on
          // every page — and every form's save button — ends up
          // underneath it. The safe area is added on top because the
          // bar itself sits above the phone's own gesture strip.
          (bottomNav ? " pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0" : "") +
          // A COLUMN, so the sheet can be told to take what is left.
          // A min-height on the sheet resolves against a parent with
          // no height of its own and comes out as nothing, which is
          // why the page stopped where its content did and the
          // background showed below it.
          (mainSurface ? " flex flex-col" : " py-4")
        }
      >
        {/* THE SHEET, when a portal asked for one. It carries the
            page's own padding, so nothing below it moves, and it runs
            from directly under the tabs to the bottom of the window —
            the file's page rather than a band across the top of it. */}
        <div
          className={
            mainSurface
              ? // FROM `lg` THE STRIP ABOVE IS THIS SHEET'S TOP, so the
                // corner belongs to it and not here — two rounded edges
                // meeting would draw a seam across a single piece of
                // paper. Below `lg` there is no strip and the sheet
                // keeps its own corner.
                // LESS ROOM ABOVE THAN BELOW — «حاول تقلل الحشو بينه
                // وبين شريط اللسان». The strip IS this sheet's top edge
                // now, in the open tab's own colour, so the page below
                // it does not need a full measure of air to be parted
                // from it: the colour has already parted them. The
                // bottom keeps its own, where the sheet meets nothing.
                // AND NO CORNER AND NO LIFT BELOW `lg`. A rounded,
                // shadowed card inset in a near-white page is a card;
                // run edge to edge with nothing beside it, the corner
                // and the shadow are drawing an edge that is not
                // there. The white IS the page on a phone.
                "flex-1 bg-surface px-4 pb-4 pt-2 max-lg:shadow-none lg:rounded-b-2xl lg:rounded-se-none lg:px-6 lg:pb-6 lg:pt-3 lg:shadow-soft"
              : "contents"
          }
        >
          {/* THE CATEGORIES, AT THE HEAD OF THE PAGE ITSELF.

              «في السوق أنت حطّيت مسافة بين الشريط والتصنيفات
               وخلّيتها في خلفية الموقع وليس بطاقة الصفحة.»

              THEY STOOD BETWEEN THE CHROME AND THE SHEET for one
              build, which put them on the site's own ground with the
              card's margin under them — a row floating in the gap
              between two things rather than belonging to either.
              They are the FIRST THING IN THE PAGE now: the card's
              white, the card's own inset, and the card's edges.

              AND FLUSH UNDER THE RULE. `-mt-2 lg:-mt-3` cancels the
              sheet's own top padding exactly, so the five pixels of
              orange and the first category touch. The air the names
              need is inside `NavRow` already.

              WHICH ROUTES GET ONE IS THE FRONT'S OWN QUESTION, and it
              is asked in the front's own file. The market's categories
              belong to the listing — «الرئيسية ما يجي تحتها تصنيفات،
               على طول بنر» — and the console's screens belong to
              whichever section is open. One rule here could not have
              said both. */}
          {band ? <div className="-mt-2 lg:-mt-3">{band}</div> : null}

          {/* AND THE PAGE'S OWN LINE UNDER THEM — see `pageBar`. It is
              the way back and a page's one action, which were chrome
              until the owner asked for the strips to go. */}
          {pageBar}

          {/* DRAWN HERE, ONCE, rather than on each of eighteen screens.
            The trail is derived from the same map the navigation reads,
            so a page cannot forget it and cannot disagree with the
            section it is highlighted under.

            EVERY ENTRY BUT THE LAST IS A LINK. A trail of plain text is
            a label that looks like navigation and answers no click. The
            group points at its first page, because a group is a heading
            rather than a destination and its first page is the nearest
            thing it has to one.

            AND NOTHING AT THE SEGMENT ROOT. A trail whose only entry is
            the page the reader is already on tells them nothing, costs
            a row of vertical space, and on the overview — which is
            meant to fit one screen — that row comes out of a chart. */}
          {breadcrumbs && here && !onDetailPage && here.page.segment !== "" ? (
            <Breadcrumbs
              className="mb-2"
              label={breadcrumbs.label}
              items={[
                ...(here.group
                  ? [
                      {
                        label: nav.groupNames[here.group.key] ?? "",
                        href: `${basePath}/${here.group.pages[0].segment}`,
                      },
                    ]
                  : []),
                {
                  label: nav.pageNames[here.page.key] ?? "",
                  href: `${basePath}/${here.page.segment}`,
                },
              ]}
            />
          ) : null}

          {children}
        </div>
      </main>

      {/* LAST IN THE DOCUMENT, AND FIXED TO THE FOOT OF THE SCREEN.
          Last because reading order should reach the page's own content
          before a list of somewhere else to go; fixed because a phone's
          navigation is only useful where the thumb already is. */}
      {bottomNav}
    </div>
  );
}
