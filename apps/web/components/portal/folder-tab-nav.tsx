"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChromeSearch } from "./chrome-search";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import {
  locatePortalPage,
  portalPages,
  type PortalNavMap,
  type PortalPage,
} from "./portal-nav";
import type { PortalTopNavLabels } from "./portal-top-nav";
import { NavRow, type NavRowItem } from "./nav-row";
import { Boxes } from "lucide-react";

/**
 * A PORTAL'S NAVIGATION — one bar, one row of file tabs.
 *
 * IT WAS THE SUPPLIER'S ALONE, and it was written as a deliberate copy
 * so the design could not reach the other panels by a flag passed from
 * the wrong place: «اعزل التعديل عن بقية اللوحات حتى لو كانت المكونات
 * مشتركة». The owner has since asked for the buyer to have it too —
 * «اجعل تصميم لوحة المشتري نفس لوحة المورد من حيث التصميم فقط» — so the
 * drawing moved here and the two portals became two thin files.
 *
 * IT STILL CANNOT SPREAD BY ITSELF. `PortalTopNav` — the shared bar
 * with the disclosure panels — is untouched and is still what the
 * console renders. A portal gets this design by handing its chrome a
 * `navSlot`, which is a decision taken in that portal's own file. There
 * is no flag here and no default that drifts.
 *
 * WHAT EACH PORTAL BRINGS is its ORDER, its STRIP and its LABELS. The
 * shape, the pile, the colours and the drawer are one implementation,
 * because «نفس التصميم» has to mean the same pixels and not two files
 * that agree today.
 *
 * NO SECTIONS AND NOTHING THAT POPS UP. «ألغِ أسماء الأقسام، وحوّل كل
 * التفريعات إلى الشريط الرئيسي — لا أحتاج إطارات منبثقة», and again for
 * the buyer: «إذا كان لديه أقسام فيها أقسام منبثقة يحوّلها جميعًا إلى
 * ألسنة». Section names that each opened a panel of their own put two
 * decisions between a reader and a page; the destinations ARE the bar,
 * in the order the portal gives them, and every one is one click from
 * anywhere.
 *
 * THE TABS STAND IN THE NAVY BAR, and that is not decoration: a white
 * tab on a near-white page is a tab nobody can see — «لكن لونه أبيض
 * والشريط أبيض، غير ظاهر لي». The bar is the folder and each tab is a
 * file standing in it, which is both the reference's own arrangement
 * and the only surface on this page dark enough to draw a white shape
 * against.
 *
 * WHAT IS NOT IN THE ROW. «الإشعارات» has a bell of its own in the
 * platform's top bar, beside the way out — «نكتفي بأيقونة الإشعارات
 * كرابط للصفحة» — so listing it here would be a second door into one
 * room. The page itself is untouched and still reachable.
 *
 * NOTHING SCROLLS SIDEWAYS. Below `lg` the row collapses to one button
 * and a column, exactly as the shared bar does.
 */

/**
 * THE DRAWER’S ID, named once so the button that opens it and the panel
 * it opens cannot drift apart.
 */
const DRAWER_ID = "portal-nav-drawer";

/**
 * THE ROW OF DESTINATIONS, AND WHAT STANDS BESIDE IT.
 *
 * ONE COMPONENT FOR EVERY FRONT AND FOR BOTH SCREENS. The wide row
 * and the narrow one are the same names from the same map, drawn by
 * `NavRow`; what a front brings is its ORDER, its STRIP and its
 * LABELS — «نفس التصميم» has to mean the same pixels, not two files
 * that agree today.
 */
export function FolderTabNav({
  portal,
  basePath,
  map,
  labels,
  tabOrder,
  brand,
  alert,
  bell,
  controls,
  searchLabels,
  mobileControls,
  navRowItems,
  navRowActiveKey,
  drawerExtra,
  pathname: given,
}: {
  /** Which front this is — it names the row's elements in the DOM. */
  portal: string;
  /** `/ar-SA`, `/ar-SA/trader`, `/ar-SA/supplier`. */
  basePath: string;
  map: PortalNavMap;
  labels: PortalTopNavLabels;
  /**
   * THE DESTINATIONS AND THEIR ORDER, by key.
   *
   * A FRONT'S OWN DECISION, taken in that front's own file. It is
   * looked up in `map` rather than listed as routes here, so the
   * addresses stay in the one place that is checked against the
   * filesystem — and the NARROW row is derived from this same list,
   * so a destination cannot exist on one screen and be missing from
   * the other.
   */
  tabOrder: readonly string[];
  /** The tenant's mark, already rendered. */
  brand?: ReactNode;
  /** «إجراء مطلوب», already rendered — it stands beside the bell. */
  alert?: ReactNode;
  /** The notifications bell, already rendered. */
  bell?: ReactNode;
  /**
   * THE LANGUAGE AND THE WAY IN OR OUT, for the WIDE row — already
   * rendered. See `RowControls`.
   */
  controls?: ReactNode;
  /** The search field's words and destination — see `ChromeSearch`. */
  searchLabels?: {
    action: string;
    placeholder: string;
    label: string;
    submitLabel: string;
  };
  /**
   * THE ROW OF NAMES, when a front does not want the one derived from
   * `tabOrder`.
   *
   * The visitor hands its own in: its two names are «الرئيسية» and
   * «السوق», and neither is a page in a portal map.
   */
  navRowItems?: readonly NavRowItem[];
  /**
   * WHICH NAME IS OPEN, when the address cannot say.
   *
   * THE ROW'S OWN RULE IS THE LONGEST HREF THAT PREFIXES THE PATH,
   * which is right wherever a name IS a place. The console's names
   * are SECTIONS: «المالية» holds three screens and its href is the
   * first of them, so the prefix rule would light it on one screen
   * and light nothing on the other two. That front knows the answer
   * from its own map and hands it in.
   */
  navRowActiveKey?: string | null;
  /** Anything a front wants at the foot of the narrow drawer. */
  drawerExtra?: ReactNode;
  /**
   * THE PATH, when a caller already holds it. It reads its own
   * otherwise — which is what a Server Component's caller cannot do.
   */
  pathname?: string;
  /**
   * THE LANGUAGE AND THE WAY IN, for the NARROW row.
   *
   * A SECOND INSTANCE, never the desktop node. One server-rendered
   * node placed twice inside a client component is MOVED rather than
   * copied — that cost the search field its place on the page for a
   * whole build, measured 0×0. Two instances have no such problem,
   * and only one of the two rows is ever visible.
   */
  mobileControls?: ReactNode;

}) {
  const read = usePathname();
  const pathname = given ?? read;
  const here = locatePortalPage(map, pathname);

  // WHICH TAB IS OPEN. A page whose tab was removed lights the tab
  // that COVERS it — see `covers` on `PortalPage`, which is where the
  // market now hangs on both fronts.
  const activePageKey = here?.page.key ?? null;

  const [drawerOpen, setDrawerOpen] = useState(false);

  /**
   * NOTHING HERE MEASURES THE TAB ROW ANY MORE.
   *
   * There was a ResizeObserver that reported the row's width to the
   * strip as `--tab-row-width`, and the strip used it as its start
   * padding so its content would begin past the tabs. That was my
   * misreading of «بداية التصنيف تبدأ من نهاية لسان الرئيسية»: it
   * cleared the whole row rather than the first tab, so the strip's
   * content started near its middle and wrapped onto a second line,
   * which grew the strip downwards. «خلّها تبدأ من بداية الشريط.»
   *
   * The strip now takes the sheet's own inset, which is a class, which
   * needs no number from here — so the observer, the state and the two
   * refs that fed it are gone rather than left computing a value
   * nobody reads.
   */
  const barRef = useRef<HTMLDivElement | null>(null);
  const drawerButtonRef = useRef<HTMLButtonElement | null>(null);

  // THE ROW, IN THE OWNER'S ORDER. Built by looking each key up in the
  // map rather than by listing routes here, so the destinations stay in
  // the one file that is checked against the filesystem.
  const byKey = new Map<string, PortalPage>(
    [map.home, ...portalPages(map)].map((page) => [page.key, page]),
  );
  const tabs = tabOrder.map((key) => byKey.get(key)).filter(
    (page): page is PortalPage => Boolean(page),
  );

  /**
   * WHETHER THIS FRONT WEARS THE OWNER'S TWO-BAR ARRANGEMENT.
   *
   * «الشريط العلوي مثل ما هو لسان وشعار قبله وأيقونة تسجيل دخول
   *  ولغة، وتحته المنتجات وينبثق منها التصنيفات، وتحت شريط منتجات
   *  يجي البحث، ثم البنر.» — asked for the visitor and the buyer:
   * «الزائر والمشتري».
   *
   * «يبقى لسان فوق، وتحته شريط التصنيفات، والشريط السفلي سادة بدون
   *  لسان» — a white bar carrying the mark, the open page's tab and
   * the icon controls, and the DESTINATIONS moved to a bar of their
   * own at the foot of the screen.
   *
   * ASKED OF THE CONTROLS, not of a flag. The fronts that hand this
   * row its own controls are exactly the fronts that were
   * rearranged; the supplier hands none and keeps the row and the
   * drawer it had — «لا تعمّم التصميم إلا بموافقتي».
   */
  const ownerStack = Boolean(mobileControls);


  const hasDrawer =
    !ownerStack && (tabs.length > 1 || Boolean(drawerExtra));

  // A NAVIGATION CLOSES WHAT OPENED IT: Next keeps this component
  // mounted across a route change inside the same layout.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // CLICKING AWAY CLOSES THE DRAWER, and so does Escape.
  useEffect(() => {
    if (!drawerOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setDrawerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDrawerOpen(false);
      drawerButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  const hrefFor = (page: PortalPage) =>
    page.segment ? `${basePath}/${page.segment}` : basePath;

  /**
   * THE NARROW ROW OF DESTINATIONS, WHEREVER ONE IS NOT HANDED IN.
   *
   * «انتقل للمورّد والمشتري.» It is the SAME `tabOrder` the wide
   * screen draws, read from the same map — so a destination cannot
   * exist on one screen and be missing on the other, and adding a
   * page to a front adds it to both without touching this file.
   *
   * NEITHER «الإشعارات» NOR «بياناتي» IS IN IT, because neither is
   * in `tabOrder`: the bell and the account glyph stand in the row
   * above, and a name beside its own glyph is one door drawn
   * twice.
   *
   * THE VISITOR STILL HANDS ITS OWN IN — its two names are «الرئيسية»
   * and «السوق», one of which carries a glyph, and neither is a
   * page in a portal map.
   */
  const rowItems: readonly NavRowItem[] =
    navRowItems ??
    tabs.map((page) => ({
      key: page.key,
      href: hrefFor(page),
      label: labels.pageNames[page.key] ?? page.key,
      badge: labels.pageBadges?.[page.key],
      // ONE GLYPH IN THE WHOLE ROW, and the FRONT says which name
      // carries it — see `marked` on `PortalPage`. A glyph beside
      // every name would be a row of pictures with captions; the
      // pages' own icons stay in the drawer, where a vertical list
      // makes a landmark of them.
      //
      // AND IT IS THE STACK OF CARTONS — «حط الأولى اللي ثلاثة
      //  كراتين». The same drawing the catalogue link has always
      // used, and the same one the owner chose over a trolley:
      // «امسحها عربة تسوق، استبدلها بأيقونة منتجات». A cart is what
      // a buyer FILLS; these names open GOODS.
      icon: page.marked ? Boxes : undefined,
    }));

  const badge = (page: PortalPage, onAccent = false) => {
    const text = labels.pageBadges?.[page.key];
    return text ? (
      <span
        className={
          "rounded-full px-1.5 py-0.5 text-[11px] font-medium " +
          // AN AMBER CHIP ON A DARK TAB STILL READS — 7.77:1 on the
          // navy — but the WHITE chip is what the open tab has always
          // used, and it is the higher of the two. What must never
          // happen is a chip in the same colour as the fill under it.
          (onAccent
            ? "bg-surface text-content"
            : "bg-accent text-accent-foreground")
        }
      >
        {text}
      </span>
    ) : null;
  };



  /**
   * THE TAB AND THE GROUP LINK ARE GONE.
   *
   * Both drew the folder shape — «احذف شكل اللسان» — and both are
   * replaced by `NavRow`, which draws the wide row and the narrow one
   * from the same names. What they carried that mattered went with
   * them: the badge is a `badge` on a row item, and the open page is
   * the wave rather than a fill.
   */

  /** The same destinations as rows — the narrow drawer only. */
  const drawerRows = () =>
    tabs.map((page) => {
      const active = activePageKey === page.key;
      return (
        <Link
          key={page.key}
          href={hrefFor(page)}
          onClick={() => setDrawerOpen(false)}
          aria-current={active ? "page" : undefined}
          data-testid={`nav-drawer-${page.key}`}
          className={
            "flex min-h-nav items-center justify-between gap-3 rounded-control px-3 py-2 text-sm " +
            (active
              ? "bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-surface))] font-semibold text-content"
              : "text-content hover:bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-surface))]") +
            " focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          }
        >
          <span className="flex items-center gap-2">
            <page.icon aria-hidden="true" className="size-4 shrink-0" />
            {labels.pageNames[page.key] ?? page.key}
          </span>
          {badge(page)}
        </Link>
      );
    });

  return (
    // IT STAYS WHEN THE PAGE MOVES, AND THE CHROME IS WHAT HOLDS IT.
    //
    // THIS ELEMENT NO LONGER STICKS ON ITS OWN. It used to, at an offset
    // written as a number — the platform bar's height, copied. That bar
    // is `min-h-nav`, a MINIMUM: it grows with a taller logo, and at
    // any device ratio that puts their shared edge on a fractional pixel
    // the two round apart and the page shows through the slit. «كأنه
    // فراغ وتمر الصفحة من تحته».
    //
    // `PortalChrome` now sticks the platform bar and this one together
    // in one box at `top-0`, so this begins exactly where that ends
    // whatever height it takes, and there is no number to keep in step.
    //
    // IT STILL CARRIES THE GROUND, and the ground is the platform's own
    // light again — «رجّع خلفية الموقع إلى لونها الأول». A strip with no
    // background of its own is a window: the page slides UNDER it and
    // shows through the gap above the tabs and the notches between them.
    <div
      ref={barRef}
      data-testid={`${portal}-nav-root`}
      className="z-40 bg-background"
    >
      <nav
        aria-label={labels.navLabel}
        data-testid="portal-top-nav"
        style={{ ["--color-focus-ring" as string]: "var(--color-on-primary)" }}
      >
        {/* FROM `lg` UP: the tabs, standing on the sheet below them.
            NOTHING IS DRAWN BEHIND THEM — no band, no box. The page's
            own background is what the resting tabs are seen against and
            the sheet is what the open one joins, which is the whole of
            the arrangement the owner drew. */}
        <div
          data-testid={`nav-panel-${portal}`}
          className="hidden px-4 pt-2 lg:block lg:px-6"
        >
          {/* THE MARK LEADS THE ROW, IN IT RATHER THAN BESIDE IT.
              «واجعل الأشرطة كاملة تبدأ من بداية بطاقة الصفحة وليس من
              بداية لسان الرئيسية» — so the mark is no longer a column of
              its own holding the strip off; the strip runs the sheet's
              whole measure below the row, mark included.

              NO GAP BETWEEN TABS. A slant leans inward as it rises, so
              any space between two shows as a wedge between their
              shoulders; butted together, the tops meet and the feet lap
              over one another. */}
          <div className="flex items-end gap-0">
            {brand ? (
              // NO AIR AFTER THE MARK — «لسان الرئيسية بعيد عن الشعار،
              // قرّبه إلى جنبه… أهم شيء أن ما يكون بينهم مسافة في كل
              // الحالتين».
              //
              // THERE WERE THIRTY-TWO PIXELS HERE, added when the tab's
              // slanted start read as the mark's own edge. That was a
              // FIXED measure against a mark whose size the tenant sets:
              // beside a small logo it is a chasm and beside a large one
              // it is a hair, and neither is a decision anyone made.
              //
              // ZERO IS THE ONLY MEASURE THAT HOLDS AT EVERY SIZE. What
              // separates the mark from the tab now is the tab's own
              // slant, which leans away from the mark as it rises and
              // needs no help from a gap.
              <div className="flex shrink-0 items-center pb-2">{brand}</div>
            ) : null}

            {/* THE ACCENT RULE IS GONE — «وحّد لون اللسان مع الشريط
                باللون البرتقالي للنشط». It was five pixels of amber
                spanning the tabs, drawn to JOIN two white surfaces. The
                strip is that same amber now, so the rule would be amber
                on amber: a line nobody can see, kept only because it
                once did something.

                THE WRAPPER STAYS. It is what makes the two shapes lap
                by thirty-two pixels and stand on one line.

                (The rule's own note, kept for why it was ever the tab
                row's to draw rather than the strip's:)
                THE ACCENT RULE BELONGED TO THE TABS, NOT THE STRIP.
                «إذا ضغطت على الرئيسية، من بداية اللسان إلى نهاية اللسان
                الخامل» — so it runs the width of the tab ROW and stops
                where the tabs stop, rather than the width of the sheet.
                It was a border on the strip, which is the sheet's own
                measure, and so it ran on past the last tab to the far
                edge of the page.

                THIS WRAPPER IS EXACTLY THAT SPAN. The two shapes lap by
                thirty-two pixels, so nothing but the box that holds them
                both knows how wide they come out — and at their FEET,
                where this rule sits, each shape is at its full width:
                the slant leans in as it rises, so the bounding edge and
                the painted edge are the same line at the bottom.

                IT HANGS BELOW THE FEET, into the strip's first five
                pixels, which is where the border used to paint. The tabs
                are positioned and this is not, so their feet cover its
                first pixel — the same overlap that keeps the seam
                between row and strip closed. */}
            {/* THE WIDE ROW WEARS THE SAME SIGNATURE AS THE PHONE.

                «ألغِ الألسنة من التصميم — تبقى الأسماء وأيقونتها،
                 واحذف الشكل»، ثم «وسطح المكتب».

                WHAT CAME OFF. Two folder shapes: the home tab and a
                long one holding every other destination, drawn with a
                mask, two slanted wings, a shade, a face, a colour run
                and a thirty-two pixel lap that every neighbour's
                margin had to know about. It cost a day of corrections
                at 393 pixels alone — the word sat on the slant, the
                badge overflowed the row, the glyph had to go to buy
                padding.

                WHAT REPLACED IT is the row of names the phone now
                carries: hairlines between them, a wave that takes the
                open name's own width and SLIDES, and a carton that
                rolls a full turn as it travels. ONE component draws
                both screens, so the platform has one signature and
                not a wide one and a narrow one to keep in step.

                THE GROUP IS GONE WITH THE SHAPE. It existed because a
                folder tab could not hold five names; a row of names
                can, and the destinations stand at one level now.

                THE STRIP IS UNTOUCHED. It still belongs to whichever
                page is open and carries that page's own controls —
                what came off is the shape, never the link between a
                page and its strip. */}
            <div className="flex items-end">
              <NavRow
                items={rowItems}
                label={labels.navLabel}
                pathname={pathname}
                activeKey={navRowActiveKey}
                idPrefix="nav-row-wide"
              />
            </div>

            {/* THE SEARCH FIELD FILLS WHAT THE TABS LEAVE.
                
                «يتمدد إلى آخر لسان موجود في الصفحة: في واجهة الزائر
                 يمتد إلى لسان الرئيسية، وفي المورد أو المشتري إلى نهاية
                 اللسان الثاني.»

                THAT IS ONE RULE, NOT TWO. It is `flex-1` between the
                tab shapes and the bell, so its near edge is wherever
                the tabs stopped — the home tab alone on the visitor's
                front, the long shape on the other two — and nothing
                here counts tabs or measures them.

                ON THE ROW'S LINE, NOT THE TABS'. The row aligns at the
                foot so the names can stand on the rule; this is not a
                name, so it takes the same ten-unit box the bell and
                the controls stand in and centres itself in it.

                AND IT IS LIFTED OFF THE RULE — «وسّع الحشو اللي بينه
                 وبين الشريط، ارفع حقل البحث فوق». Measured before:
                the field's foot sat at 56 with the rule at 58, so a
                white box with a border ended two pixels above a five
                pixel band of the identity's orange. Eight of margin
                puts ten between them.

                EIGHT AND NOT TWELVE, so the row does not grow. The
                names' box is 50 tall and this one is 40; a margin of
                eight keeps it at 48 and the header's height is still
                the names'. */}
            {searchLabels ? (
              <div className="mb-2 flex h-10 min-w-0 flex-1 items-center px-4">
                <ChromeSearch {...searchLabels} />
              </div>
            ) : null}

            {/* WHAT IS WAITING, THE BELL, AND THE CONTROLS — at the
                other end and on the row's line. None of them is a tab,
                so they keep its height and none of its shape. */}
            {alert || bell || controls ? (
              <div className="ms-auto flex h-10 shrink-0 items-center gap-control-gap pe-2 ps-4">
                {alert}
                {bell}
                {controls}
              </div>
            ) : null}
          </div>
        </div>

        {/* THE NARROW ROW, AS THE OWNER SETTLED IT: «يبقى لسان فوق
            وشعار وأيقونة اللغة والإشعارات».

            AND IT IS WHITE, which is the correction that matters:
            «الشريط العلوي أبيض، عشان كذا لما يكون كحلي يخرب شكل الشعار
             والأيقونات». It was painted in the identity's navy for one
            build, and everything on it then needed its ink inverted —
            the mark is drawn for a light ground, the glyphs are the
            identity's own colour, and the language disc has its lines
            CUT OUT of it in the page's colour. Three repairs for one
            wrong decision. The ground is light again and all three are
            gone.

            THE TAB IS THE REAL TAB, and on this ground it draws exactly
            what the wide row draws: navy when open, the page's own
            light when not.

            NO DESTINATIONS HERE. They stand in the bar at the foot of
            the screen — see `BottomNav`. This row answers «أين أنت»;
            that one answers «إلى أين». */}
        {/* THE NARROW CHROME, AS THE OWNER SETTLED IT AFTER A DAY OF
            DRAWING: two rows that stick, and the folder tab gone.

            «يبقى الشريط فوق فيه الشعار والأيقونات، وتحته الوجهات
             والشريط المنزلق — تكون ثابتة.»

            ROW ONE carries the mark, the search and the two glyphs;
            the search stays on every page, «يبقى في كل الصفحات».

            ROW TWO is the destinations, and under them the platform's
            new signature — see `NavRow`.

            THE SUPPLIER'S OLD ROW IS STILL HERE, unchanged, for any
            front that hands in no controls of its own. */}
        {ownerStack ? (
          <>
            <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 lg:hidden">
              {brand ? (
                // SEVENTY-TWO AND NO MORE. The mark keeps its own
                // height and takes whatever width its ratio makes of
                // it; a wide tenant logo would otherwise push the
                // search off a 360-pixel screen.
                <div className="flex max-w-[72px] shrink-0 items-center">{brand}</div>
              ) : null}

              {searchLabels ? (
                // THE FIELD FILLS WHAT THE MARK AND THE GLYPHS LEAVE.
                // Thirty-six tall here rather than forty-four: it is
                // not the only thing a thumb lands on in this row, and
                // the row has to hold four things inside 360.
                // THE ROUNDING IS THE FIELD'S OWN NOW — see
                // `ChromeSearch`. It was set here, for this row only,
                // while the wide row's field stayed square; one field
                // cannot be two shapes.
                <div className="min-w-0 flex-1 [&_button]:min-h-[36px] [&_input]:h-9">
                  <ChromeSearch {...searchLabels} />
                </div>
              ) : null}

              {mobileControls ? (
                // THEY DRAW TOGETHER — «المسافة بين دخول وأيقونتها
                //  كبيرة، والمسافة بين دخول واللغة برضو كبيرة، قرّبها
                //  أكبر قدر ممكن». The controls carry the platform's
                // own padding, which is right for a row that has
                // room; this row has a mark, a field and two
                // controls inside 393. So the gap between them is
                // four rather than eight, and each sheds the side
                // padding it wears elsewhere.
                //
                // BY DESCENDANT SELECTOR because they arrive built,
                // from a Server Component, and this row has no class
                // to hand them.
                <div className="flex shrink-0 items-center gap-1 [&_a]:gap-1 [&_a]:px-1">
                  {mobileControls}
                </div>
              ) : null}
            </div>

            {rowItems.length > 0 ? (
              <div className="no-scrollbar overflow-x-auto bg-surface px-3 lg:hidden">
                <NavRow
                  items={rowItems}
                  label={labels.navLabel}
                  activeKey={navRowActiveKey}
                  // THE PATH THIS NAV ALREADY RESOLVED. It accepts one
                  // from a caller and falls back to reading its own;
                  // handing the resolved value down means the row and
                  // the tabs can never disagree about where we are.
                  pathname={pathname}
                />
              </div>
            ) : null}


          </>
        ) : (
          <div className="flex items-center bg-primary px-4 lg:hidden">
            <Link
              href={hrefFor(map.home)}
              onClick={() => setDrawerOpen(false)}
              aria-current={activePageKey === map.home.key ? "page" : undefined}
              data-testid={`nav-home-${map.home.key}`}
              className="inline-flex min-h-nav items-center gap-1.5 whitespace-nowrap px-3 text-sm text-accent-interactive hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
            >
              <map.home.icon aria-hidden="true" className="size-4 shrink-0" />
              {labels.pageNames[map.home.key] ?? map.home.key}
            </Link>

            {hasDrawer ? (
              <button
                ref={drawerButtonRef}
                type="button"
                aria-expanded={drawerOpen}
                aria-controls={DRAWER_ID}
                aria-label={drawerOpen ? labels.closeMenu : labels.openMenu}
                data-testid="portal-menu-button"
                onClick={() => setDrawerOpen((was) => !was)}
                className="ms-auto inline-flex min-h-nav w-11 shrink-0 items-center justify-center rounded-control text-accent-interactive hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {drawerOpen ? (
                  <X aria-hidden="true" className="size-control" />
                ) : (
                  <Menu aria-hidden="true" className="size-control" />
                )}
              </button>
            ) : null}
          </div>
        )}
      </nav>

      {/* THE LINE — five pixels of the identity's orange, and the
          whole of what is left of the strips.

          «بنلغي الشريط من جميع الصفحات ونكتفي بالشريط الخمسة بكسل
           اللي نفس الرئيسية.»

          THE CATEGORIES USED TO UNFOLD OUT OF IT on a phone, inside
          the sticky box, growing the chrome by 37 pixels on the one
          page that browses; on a wide screen a navy bar did the same
          job with a colour run in it. Both are gone and the
          categories stand in the PAGE — see `CategoryBand`.

          AT EVERY WIDTH, because it is the FOOT OF THE CHROME: what
          the page slides under, and what the wave stands on.
          Hiding it above `lg` would leave the signature resting on
          nothing on the screen with the most room to show it. */}
      <div className="h-[5px] bg-accent-interactive" data-testid="chrome-rule" />

      {/* THE OPEN TAB'S OWN STRIP, the width of the page, and stuck to
          the tabs because it is INSIDE the element that sticks. The
          owner's instruction: «اجعل لكل لسان شريط ممتد على طول الصفحة
          ويكون فيه مثلًا التاريخ أو البحث، ويكون ثابت وباقي الصفحة
          متحركة».

      {/* AND NO STRIP UNDER IT ANY MORE — «ما أحتاج شريط، وأي
          معلومات كانت في الأشرطة السابقة تنزل في الصفحة».

          The bar that carried the way back, a page's one action and
          whatever a page handed up through its slot is drawn INSIDE
          the page now — see `PortalChrome`. Nothing about what it
          carries changed; it changed which side of the chrome's edge
          it is on. */}

      {/* THE WHITE BAND THAT USED TO SIT HERE IS GONE — «الشريط الأبيض
          اللي تحت الشريط الأصفر يجب أن تحذفه». It was sixteen pixels of
          the page's own white riding along so that a card scrolling up
          would not stop against the feet of the tabs. The strip above
          does that job now and does it better: it is opaque, it is the
          sheet's own width, and it is the sheet's own top — so what
          comes up from below passes behind it and meets nothing. */}

      {/* ALWAYS IN THE DOCUMENT, HIDDEN WHEN CLOSED. It used to be
          rendered only while open, which left `aria-controls` on the
          button pointing at an element that did not exist — a promise
          to assistive technology that the page did not keep. `hidden`
          takes it out of the layout, the accessibility tree and the tab
          order alike, which is what closed means. */}
      {hasDrawer ? (
      <div
        id={DRAWER_ID}
        hidden={!drawerOpen}
        data-testid="portal-nav-drawer"
        className="max-h-[70vh] overflow-y-auto border-t border-line bg-surface px-2 py-2 lg:hidden"
      >
          {/* THE SEARCH, FIRST AND FULL WIDTH. The field lives in the
              tab row on a wide screen, and that row is hidden here — so
              a phone had no search at all.

              ITS OWN NODE, NOT THE ROW'S. The first attempt rendered
              the `search` prop in both places, and it cost the desktop
              its field: measured at 1366 and 1600, the row's input came
              back 0×0 with `BODY` as its grandparent. A node handed
              down from a Server Component is a payload rendered once —
              placing it twice inside a client component moves it rather
              than copying it. Two instances, built by the layout, have
              no such problem.

              FORTY-FOUR TALL HERE, thirty-six there. The height is set
              by a DESCENDANT selector rather than by a class handed to
              the field, because `cn` joins classes and does not merge
              them — two `height` utilities on one element would be
              settled by stylesheet order, which is nobody's decision.
              `[&_input]` is (0,1,1) and beats the field's own (0,1,0)
              every time. */}
        {/* NOT WHERE IT STANDS IN THE OPEN. On the two fronts the
            owner rearranged, the field has a row of its own above —
            a second copy of one search inside the menu is two
            answers to one question. The supplier keeps it here,
            because that front's narrow row is untouched. */}
        {!ownerStack && searchLabels ? (
          <div
            data-testid="portal-nav-drawer-search"
              // A SEARCH CLOSES THE DRAWER, exactly as pressing a
              // destination does. Measured otherwise: the results
              // arrived behind an open drawer covering them.
              //
              // ON CAPTURE, so it runs before the field's own handler
              // and cannot be skipped by it.
              onSubmitCapture={() => setDrawerOpen(false)}
              className="mb-2 flex [&_button]:min-h-[44px] [&_input]:h-11"
            >
              <ChromeSearch {...searchLabels} />
            </div>
          ) : null}

          <div className="flex flex-col">{drawerRows()}</div>

          {/* AND THE DESTINATIONS THE TABS DO NOT CARRY — see
              `drawerExtra`. Below the tabs, because a tab is where the
              reader already is and this is where else they may go. */}
          {drawerExtra ? <div className="flex flex-col">{drawerExtra}</div> : null}
      </div>
      ) : null}
    </div>
  );
}
