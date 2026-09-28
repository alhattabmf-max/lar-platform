"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * WHAT A PAGE'S STRIP CARRIES. Two links at most, and a portal's own
 * route table decides which — see `supplier-bar-actions` and
 * `trader-bar-actions`. The shape is here because the strip is what
 * renders it; the mapping stays with the portal that owns the routes.
 */
export interface PortalBarLinks {
  /** The page's one action — «إضافة منتج». Absent where there is none. */
  action?: { href: string; label: string };
  /** The way back out of a form — «العودة إلى المنتجات». */
  back?: { href: string; label: string };
}

/**
 * WHERE A PAGE'S OWN ROW LANDS IN THE STRIP.
 *
 * Named once and imported by both sides, so the strip and the page
 * cannot disagree about it — a string typed twice is a slot that works
 * until somebody renames one of them.
 */
export const PORTAL_STRIP_SLOT = "portal-strip-slot";

/**
 * THE SAME SLOT, FOR THE ROW A NARROW SCREEN DRAWS.
 *
 * «وين اسم المنشأة، وين كلمة منشأة موثقة والصح الأخضر، وين رقم
 *  السجل التجاري؟ هذي كانت في شريط بياناتي — ما قلت احذف الشريط،
 *  قلت احذف البحث عشان تظهر البيانات.»
 *
 * TWO IDS AND NOT ONE, because `getElementById` answers with the
 * FIRST match: one id on two elements would send everything to the
 * wide strip, which is `display:none` on a phone — the content
 * would be in the document and on no screen. The page fills both
 * and the stylesheet shows exactly one.
 */
/* `PORTAL_STRIP_SLOT_NARROW` IS GONE. The chrome drew a second,
   narrow copy of this line while the wide one lived above `lg`
   only; the line is inside the PAGE now and one target serves every
   width — «ما أحتاج شريط، وأي معلومات كانت في الأشرطة السابقة تنزل
    في الصفحة». */

/**
 * THE OPEN TAB, CONTINUED — the top of ITS page, not a band across
 * the platform's.
 *
 * The owner's instruction, in passes: «اجعل لكل لسان شريط ممتد على طول
 * الصفحة… ويكون ثابت وباقي الصفحة متحركة»; then «اجعل الشريط كأنه
 * امتداد للسان»; then the correction that decided the shape — «الشريط
 * تابع للسان في نفس صفحة اللسان وليس على امتداد صفحة المنصة… أبغى
 * اللسان يكون كأنه صفحة وحدة مع الشريط».
 *
 * So it takes the SHEET'S measure, not the window's: the tab's foot,
 * this strip and the white page below it are one continuous piece of
 * paper, and the platform's dark ground shows on either side of all
 * three.
 *
 * IT STICKS WITH THE TABS, not on its own. It is rendered INSIDE the
 * element that already sticks, so the two travel as one piece and the
 * page scrolls under both.
 *
 * WHAT IS IN IT IS ONLY WHAT MOVED HERE. A date and a search box were
 * tried and struck off — «احذف التاريخ وأي شيء أنت أضفته للشريط». What
 * remains is what the deleted dark bars used to carry: a page's one
 * action, the way back out of a form, and whatever row a page hands up
 * through the slot below. The strip is the sheet's top edge first and a
 * place for controls second, so an empty one on a page that has none of
 * the three is finished rather than unfinished.
 *
 * THE PAGE'S NAME IS NOT IN IT. The tab above is lit and carries that
 * name — «نكتفي باسم القسم في اللسان كعنوان للصفحة».
 */
export function PortalPageBar({
  /** What this address puts in the strip — see the portal's own table. */
  links,
  /**
   * WHAT THE CHROME PUTS IN THE STRIP on this tab.
   *
   * The slot below is for what a PAGE hands up — live controls holding
   * figures only the page has. This is the other kind: the categories
   * and the way into the whole list, which belong to the market tab
   * itself and are the same on every page under it. «وفي شريط السوق حط
   * التصنيفات وعرض الكل».
   *
   * IT LEADS, because it is navigation: in Arabic the row runs right to
   * left, so it sits with the way back rather than opposite it.
   */
  content,
  /**
   * WHAT THE CHROME PUTS AT THE FAR END — «وخل الأيقونة في الجهة
   * المقابلة من اللسان».
   *
   * `content` leads, with the way back; this trails, opposite it. In
   * Arabic the row runs right to left, so the far end is the left, and
   * `justify-between` decides that without a direction branch.
   */
  endContent,
  /**
   * WHETHER THE STRIP GIVES UP ITS START INSET.
   *
   * «اجعل الشريط البرتقالي يبدأ من الحافة اليمنى للسان الرئيسية ويمتد
   * لليسار، دون امتداده تحت الشعار.» The mark stands before the row
   * now, so the strip's own inset would put it under the mark. It
   * starts where the column of tabs starts instead — which IS the first
   * tab's leading edge, at any mark width and in either direction.
   */
  flush,
  /**
   * Which portal is drawing it, for the test id only.
   *
   * The strip is one component and one design — «اجعل تصميم لوحة
   * المشتري نفس لوحة المورد» — but a test that asks "is the buyer's
   * strip on this page" has to be able to name it.
   */
  portal,
}: {
  links: PortalBarLinks;
  content?: ReactNode;
  endContent?: ReactNode;
  flush?: boolean;
  portal: string;
}) {
  return (
    // ONE PIXEL UNDER THE TABS, and it is not a fudge.
    //
    // «ما زال اللسان معزول عن الشريط وهذا مرفوض». Two boxes that merely
    // TOUCH are a seam: at any zoom or device ratio that puts their
    // shared edge on a half pixel, the parent shows through as a
    // hairline — and the parent here is the platform's navy, so that
    // hairline is dark and reads as a line ruled under every tab.
    // Pulling the strip up by a pixel makes the two OVERLAP instead of
    // meet, and since the open tab's fill and this fill are the same
    // colour the overlap is invisible and the seam cannot come back.
    //
    // THE SHEET'S MEASURE AND THE SHEET'S CORNER. Inset exactly as the
    // page below is, with the far top corner rounded and the near one
    // square because the first tab stands on it.
    <div
      data-testid={`${portal}-page-bar`}
      className={
        // SHORTER AGAIN, AND FOR THE SAME REASON — «واكتفِ بالأيقونة
        // أو الاسم… بعد أكبر قدر ممكن عشان أقلّل ارتفاع الشريط».
        //
        // NOTHING IN IT IS BOXED NOW, so the strip needs no air of its
        // own on top of the reach its controls already carry: it rests
        // exactly on the 32px every control in it stands at, and the two
        // accent rules close it. Fifty pixels became forty-two, and the
        // eight that went were a box's padding and the strip's own
        // padding around it.
        //
        // SHORTER, BY AIR AND NOT BY TYPE — «قلّل ارتفاع الشريط
        // البرتقالي بتخفيف الحشو، دون تصغير الخط أو الأزرار».
        //
        // It stood on the rail floor of 44px, the touch target a destination
        // in a RAIL is owed. Nothing in it is a rail entry — the tallest
        // thing here is a 32px control — so the floor was holding eight
        // pixels of air that belonged to nothing. The controls keep
        // every pixel they had.
        // AND IT KEEPS A FLOOR, because the strip IS the sheet's top
        // edge — it carries the rounded corner and joins the open tab.
        // An empty one collapsing to eight pixels of air would leave a
        // sliver of orange where a page begins. The floor is what the
        // strip actually holds: a control, and its own air.
        // AND IT HAS NO SURFACE OF ITS OWN ANY MORE.
        //
        // «بنلغي الشريط من جميع الصفحات ونكتفي بالشريط الخمسة بكسل
        //  اللي نفس الرئيسية، والتصنيفات أو أي معلومات في الأشرطة
        //  تبقى في الصفحة بنفس خلفية الصفحة مع تغيير لون الكتابة
        //  للبرتقالي بنفس درجة لون الشريط النحيف.»
        //
        // WHAT CAME OFF, AND WHY EACH PIECE EXISTED: a colour run that
        // began at the open folder tab's own fill so the two would
        // read as one sheet of paper; a card corner at the head and a
        // square foot, because the page card below curves at ITS head
        // and two curves facing each other are a pinch; the card
        // system's shadow, so the lift ran unbroken from the tab into
        // the strip; and white ink, which only worked because of all
        // three. The tab is gone, so the run had nothing to continue,
        // and the surface had nothing left to be.
        //
        // WHAT REMAINS is a line of the page's own content: the page's
        // ground, the identity's orange for its links, and the sheet's
        // own inset so it lines up with everything below it. The
        // orange measures 4.8:1 on that ground and 5.0:1 on white.
        // AND NO HEIGHT AT ALL WHEN IT HOLDS NOTHING — «فيه مسافة
        //  واضحة، لصقه في الشريط، ما أبغى مسافة بينهم».
        //
        // THE FLOOR OUTLIVED ITS REASON. It was 32 so an empty bar
        // would not collapse and leave a sliver of its own colour
        // where a page begins; there is no colour any more, so an
        // empty bar with a floor is 32 pixels of the site's ground
        // between the rule and the page card — measured on a wide
        // screen, and exactly the gap the owner is pointing at.
        //
        // IT STILL HAS ONE WHEN IT HOLDS SOMETHING, so a row with one
        // short link in it does not sit at that link's own height.
        // What the PAGE hands up through the slot brings its own.
        (content || endContent || links.back || links.action
          ? "min-h-control "
          : "") +
        "me-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pe-4 text-accent-interactive lg:me-6 lg:pe-6 " +
        (flush
          ? "ms-0 ps-0"
          : // IT STARTS WHERE THE STRIP STARTS — «خلّها تبدأ من بداية
            // الشريط، لأني لاحظت أن الشريط يبدأ من النص ممّا سمح لبعض
            // المعلومات تمدد الشريط للأسفل».
            //
            // WHAT IT USED TO DO, and it was my misreading. The ask was
            // «بداية التصنيف تبدأ من نهاية لسان الرئيسية» — past the
            // FIRST tab. I measured the whole row instead, so the
            // padding cleared the mark and every tab and the open
            // page's name, and the content began near the middle of the
            // strip. Half a strip is not room for a row of categories:
            // they wrapped, and each wrapped line pushed the strip's
            // own foot further down the page.
            //
            // SO THE INSET IS THE SHEET'S, AND NOTHING ELSE. The strip
            // is the page card's top edge, and its content lines up
            // with the card's content — which is the same alignment
            // every other row on the page keeps.
            "ms-4 ps-4 lg:ms-6 lg:ps-6")
      }
    >
      <div className="flex min-w-0 items-center gap-4">
        {content}
        {links.back ? (
          <Link
            href={links.back.href}
            // THE CONTROL HEIGHT, NOT THE RAIL'S. A 44px link inside a strip
            // whose other controls are 32 was holding the strip open on its
            // own — «قلّل ارتفاع الشريط بتخفيف الحشو».
            className="inline-flex min-h-control shrink-0 items-center gap-control-gap text-sm font-medium text-accent-interactive hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          >
            {links.back.label}
            {/* THE ARROW POINTS THE WAY BACK: outward in Arabic, as the
                reference draws it, and leading in English, where a back
                link trailing its own arrow reads as going forward. */}
            <ArrowLeft aria-hidden="true" className="size-4 shrink-0 ltr:order-first" />
          </Link>
        ) : null}
      </div>

      {/* THE FAR END OF THE ROW: what the PAGE puts there, then its one
          action.

          «عدّلهم وحطهم يسار» — in Arabic the row runs right to left, so
          the far end is the left. A page's own controls sat beside the
          way back, crowding it; they belong opposite it.

          A PORTAL, NOT A ROUTE TABLE. The links are derived from the
          address because each is only an href and a word; what lands
          here is live controls holding data only the page has — the
          instant its figures were read, the record's own name and
          number. Copying any of it into the chrome would be a second
          source of truth, so the page keeps its component and renders
          it HERE.

          EMPTY IS INVISIBLE: no width and no gap until a page fills it. */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-4">
        {/* THE SLOT TAKES WHAT IS LEFT, and hands it on. A row that wants
            the whole strip — the company's own identity, its name at one
            end and its registration number at the other — asks for it
            with `w-full`; a row that does not simply sits at the far end,
            which is the left in Arabic. */}
        <div id={PORTAL_STRIP_SLOT} className="flex min-w-0 flex-1 items-center justify-end empty:hidden" />

        {endContent}

        {links.action ? (
          // THE PAGE'S ONE ACTION — ITS NAME, AND NO BOX ROUND IT.
          //
          // «ألغِ أي أزرار داخل مربع في أشرطة اللسان واكتفِ بالأيقونة أو
          // الاسم… عشان أقلّل ارتفاع الشريط.»
          //
          // It was a raised white pill, which is a box inside the band
          // the strip already is — and its padding was part of what held
          // that band open. What is left is the word, at the reach a
          // control is owed.
          <Link
            href={links.action.href}
            className="inline-flex min-h-control shrink-0 items-center justify-center text-[length:var(--control-font-size)] font-medium text-accent-interactive hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {links.action.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
