"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * ONE ENTRY IN A PANEL — and, where the thing it names has its own,
 * the entries under it.
 *
 * RECURSIVE, because a catalogue is. A flat list here is what kept a
 * third-level category off every visitor surface: «حطّيت تصنيفًا
 * فرعيًّا لفرع، وعند الضغط عليه ما انبثق منه الفرع الفرعي».
 */
export interface NavRowChild {
  id: string;
  label: string;
  href: string;
  children?: readonly NavRowChild[];
}
export interface NavRowItem {
  /** Matched against the open page, and the React key. */
  key: string;
  href: string;
  label: string;
  /**
   * A GLYPH BEFORE THE NAME, where the name alone is not enough.
   *
   * «أرجو إضافة أيقونة تسوّق بجانب السوق.» Only where it earns its
   * place: «الرئيسية» needs no picture, and a row where every item
   * has one is a row of pictures with captions.
   */
  icon?: LucideIcon;
  /**
   * THE BRANCHES UNDER THIS NAME, where it has any.
   *
   * «التصنيفات غابت أسهم الفروع حقّتها.» A name with branches is
   * NOT a link here: it is a control that opens them, exactly as
   * the wide screen's strip has always worked. The category
   * itself stays reachable as the panel's first row, so having
   * branches never costs a category its own listing.
   *
   * THE PANEL IS NOT DRAWN HERE. This row lives inside a
   * horizontal scroller, and a scroller with `overflow-x: auto`
   * computes `overflow-y` to `auto` as well — anything absolute
   * hanging below the row would be clipped by it. So the row
   * reports WHICH control was pressed and WHERE it stands, and
   * the caller outside the scroller draws it.
   */
  children?: readonly NavRowChild[];
  /**
   * A COUNT BESIDE THE NAME — what the file tab carried.
   *
   * The tabs said «٣» on «المتابعة» when three things were
   * waiting. Replacing them with plain names would have deleted
   * that quietly, and a buyer would learn about a dispute by
   * opening the page on the off-chance.
   */
  badge?: string;
}

/**
 * THE ROW OF DESTINATIONS, AND THE PLATFORM'S SIGNATURE UNDER IT.
 *
 * «ألغِ الألسنة من التصميم — تبقى الأسماء وأيقونتها، واحذف الشكل.»
 *
 * WHAT REPLACED THE FOLDER TAB. The tab was drawn with a mask, two
 * slanted wings and a colour run whose arithmetic had to be kept in
 * step by hand; it cost a day of corrections at 393 pixels — the word
 * sat on the slant, the badge overflowed the row, the glyph had to go
 * to buy padding. What is here instead is a row of names with hairline
 * rules between them, and ONE moving shape:
 *
 *   A WAVE, eleven pixels tall, that takes the width of the open name
 *   and SLIDES to the next one rather than jumping.
 *
 *   A CARTON that rolls a full turn while it travels and lands at the
 *   same angle it left — the owner's own drawing: three faces, orange
 *   seams, a 0.6 outline so it is still there while it crosses white.
 *
 * WHY MOTION AND NOT A SHAPE. «لازم نسوي شي مجرد ما يشوف الشخص أول شي
 * يجي في باله منصتي.» A shape can be copied from a screenshot; the way
 * a thing moves cannot. And of everything we drew — pills, notches,
 * domes, ticket cuts, interlocking discs — the rolling carton is the
 * only one that says what this platform IS: goods, moving.
 *
 * THE POSITION IS MEASURED, NOT WRITTEN. The wave spans the open item
 * and the carton centres on it, so both follow whatever the operator
 * names a page and whatever the browser does to the font. There is no
 * table of pixel offsets here to fall out of date — «ليه ما يبدأ من
 * النص ويوقف في النص» was exactly the defect a hard-coded offset
 * produced.
 *
 * IT RESPECTS `prefers-reduced-motion`. Somebody who has asked their
 * device for less movement gets the wave in its new place with no
 * travel and no roll. That is not a preference to weigh; it is what
 * that setting means.
 */
export function NavRow({
  items,
  label,
  pathname: given,
  tone = "surface",
  activeKey: forced,
  idPrefix = "nav-row",
  panelLeadLabel,
  action,
}: {
  items: readonly NavRowItem[];
  /** The row's own accessible name. */
  label: string;
  /** The path, when a caller already holds it. It reads its own otherwise. */
  pathname?: string;
  /**
   * WHICH SURFACE THIS ROW STANDS ON.
   *
   * `surface` — the destinations, dark ink on the page's white, an
   * orange wave and the carton rolling over it.
   *
   * `band` — the categories. NEITHER THE WAVE NOR THE CARTON COMES
   * HERE.
   *
   * THEY USED TO BE WHITE ON A BAND OF THE IDENTITY'S ORANGE. The
   * band is gone — «بنلغي الشريط من جميع الصفحات… والتصنيفات تبقى
   *  في الصفحة بنفس خلفية الصفحة مع تغيير لون الكتابة للبرتقالي
   *  بنفس درجة الشريط النحيف» — so the ink carries what the surface
   * used to: the same `#b45309`, which measures 4.8:1 on the page's
   * ground and 5.0:1 on white. Above the 4.5 a body text owes.
   *
   * I DREW THE WAVE IN BOTH ROWS FOR ONE BUILD and the owner saw it on
   * a phone: «الموجة تُلغى لأنها قبيحة بعد أن شفتها ومعطية خلل بصري».
   * Two waves eleven pixels apart, one rising and one inverted, read as
   * a fault in the drawing rather than as an answer. So the signature
   * belongs to ONE row, and the open category is said in ink alone:
   * full white against the rest held back. No shape at all.
   */
  tone?: "surface" | "band";
  /**
   * WHICH ITEM IS OPEN, when the path cannot say.
   *
   * A CATEGORY IS CHOSEN IN THE QUERY STRING, not in the path — the
   * listing is one route filtered by `taxonomyNodeId`. So the caller
   * that reads the query hands the answer in, and the row does not
   * grow a second way of asking.
   */
  activeKey?: string | null;
  /**
   * WHAT NAMES THIS ROW IN THE DOCUMENT.
   *
   * TWO ROWS EXIST AT ONCE. The wide one and the narrow one are both
   * in the markup and the stylesheet chooses between them, so one
   * `data-testid` on both is an ambiguous address — `getByTestId`
   * threw `Found multiple elements` the moment the second appeared.
   * That is not a test detail: two elements answering to one name is
   * also two things an assistive technology cannot tell apart.
   */
  idPrefix?: string;
  /**
   * THE PANEL'S FIRST ROW, where the opened name is a place of its
   * own — «كل الفروع» over a category's branches.
   *
   * OMITTED WHERE IT IS NOT. A console SECTION is a heading, not a
   * page, so its panel opens straight into its screens and a first
   * row pointing at the section itself would point at nothing.
   */
  panelLeadLabel?: string;
  /**
   * ONE CONTROL AT THE ROW'S FAR END, level with the names.
   *
   * «أيقونة المساعدة حطها في نفس الصفحة موازية لأسماء الصفحات.» It
   * had a row of its own between the rule and the page — one button
   * on a line, which read as a band parting them.
   *
   * IT IS NOT A DESTINATION, so it is not an item: the wave must
   * never slide under it and a screen reader must not hear it
   * announced among the places this row leads.
   */
  action?: ReactNode;
}) {
  const read = usePathname();
  const pathname = given ?? read;

  /**
   * WHICH NAME IS OPEN — the longest href that prefixes the path.
   *
   * A front's root is a prefix of every page under it, so a plain
   * `startsWith` lights the first item everywhere. The longest match is
   * the one you are actually inside.
   */
  const matched =
    items.reduce<{ key: string | null; len: number }>(
      (best, item) => {
        const hit =
          pathname === item.href || pathname.startsWith(`${item.href}/`)
            ? item.href.length
            : 0;
        return hit > best.len ? { key: item.key, len: hit } : best;
      },
      { key: null, len: 0 },
    ).key ??
    items[0]?.key ??
    null;

  const activeKey = forced !== undefined ? forced : matched;

  const band = tone === "band";

  const rowRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLElement | null>());

  /**
   * WHICH NAME HAS ITS PANEL OPEN, AND WHERE THAT PANEL HANGS.
   *
   * THE ROW OWNS THIS NOW. It was the caller's for one build — the
   * row reported which control was pressed and the caller drew the
   * panel — and that meant every caller with sections had to repeat
   * the measuring, the clamping, the portal and the four ways of
   * closing. Two copies of that is two behaviours the first time
   * either is touched.
   *
   * IN VIEWPORT COORDINATES, because the panel is drawn in the body:
   * TWO boxes clip anything hanging below this row and both were
   * measured doing it — the horizontal scroller a row usually sits
   * in, since `overflow-x: auto` computes `overflow-y` to `auto` as
   * well; and any fold above it. Neither can be relaxed for a menu.
   */
  const panelRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState<{
    key: string;
    href: string;
    children: readonly NavRowChild[];
    left: number;
    top: number;
  } | null>(null);

  const openItem = (item: NavRowItem, element: HTMLElement) => {
    // A SECOND PRESS SHUTS IT — the control is a toggle, which is
    // what `aria-expanded` on it promises.
    if (open?.key === item.key) {
      setOpen(null);
      return;
    }
    const row = rowRef.current;
    if (!row) return;
    // LIVE RECTS, so however far the row has been scrolled and
    // whichever way the page runs are already in the numbers.
    setOpen({
      key: item.key,
      href: item.href,
      children: item.children ?? [],
      left: element.getBoundingClientRect().left,
      top: row.getBoundingClientRect().bottom,
    });
  };

  // IT NEVER HANGS OFF THE SCREEN. The panel is as wide as its
  // widest entry, which is not known until it is drawn, so the
  // overflow is corrected once it exists rather than guessed at.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !open) return;
    const room = window.innerWidth - panel.offsetWidth - 8;
    if (open.left > room) {
      setOpen((was) => (was ? { ...was, left: Math.max(8, room) } : was));
    }
  }, [open]);

  // WHAT SHUTS IT: a press anywhere outside, Escape, and the row
  // being scrolled under it — the third because a panel pinned to a
  // name that has slid away points at nothing.
  useEffect(() => {
    if (!open) return;
    const row = rowRef.current;
    const shut = () => setOpen(null);
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      // THE PANEL COUNTS AS INSIDE even though it is drawn in the
      // body. Without this, pressing an entry shuts the panel on
      // `pointerdown` and the link it was standing on is gone
      // before the `click` — the press would do nothing at all.
      if (row?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      shut();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") shut();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    const scroller = row?.parentElement;
    scroller?.addEventListener("scroll", shut, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      scroller?.removeEventListener("scroll", shut);
    };
  }, [open]);

  // AND ARRIVING SOMEWHERE SHUTS IT TOO. Following an entry is a
  // client navigation: nothing unmounts, so without this the panel
  // would still be standing over the page it just opened.
  useEffect(() => {
    setOpen(null);
  }, [pathname, activeKey]);

  /** Where the wave stands: the open item's box, in the row's own space. */
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  /**
   * WHETHER THE FIRST MEASUREMENT HAS LANDED.
   *
   * The wave starts with no width and no place, and its transition would
   * animate it OUT of that on every cold load — a swoosh from the corner
   * that means nothing. Measured: the first rect can arrive late, after
   * the web font resizes the names. So the first placement is instant
   * and every one after it slides.
   */
  const [placed, setPlaced] = useState(false);

  /**
   * HOW FAR THE CARTON HAS ROLLED, in whole turns.
   *
   * A COUNTER AND NOT AN ANGLE, because the transition has to see a
   * DIFFERENT number every time or it will not animate: rotating to
   * 360° twice is rotating to the same place. Each move adds a turn, so
   * the carton always arrives standing the way it left.
   */
  const [turns, setTurns] = useState(0);
  const firstMeasure = useRef(true);

  useLayoutEffect(() => {
    const row = rowRef.current;
    // `!= null` AND NOT A TRUTH TEST: a key may legitimately be the
    // empty string — the band uses it for «جميع المنتجات» — and an
    // empty string is falsy, so the lookup was skipped and the wave
    // measured zero wide. Measured, not guessed at.
    const active =
      activeKey != null ? (itemRefs.current.get(activeKey) ?? null) : null;
    if (!row || !active) return;

    const place = () => {
      const rowRect = row.getBoundingClientRect();
      const itemRect = active.getBoundingClientRect();
      setPlaced(true);
      setBox({
        // MEASURED FROM THE ROW, not from the window, so the value
        // survives the page scrolling under it.
        left: itemRect.left - rowRect.left,
        width: itemRect.width,
      });
    };

    place();

    // AND AGAIN WHEN ANYTHING MOVES. A web font landing changes every
    // name's width after the first paint; a rotation changes them all.
    const observer = new ResizeObserver(place);
    observer.observe(row);
    observer.observe(active);
    return () => observer.disconnect();
  }, [activeKey, items]);

  useEffect(() => {
    // THE FIRST PAINT IS NOT A MOVE. Rolling on arrival would spin the
    // carton every time a page is opened cold.
    if (firstMeasure.current) {
      firstMeasure.current = false;
      return;
    }
    setTurns((was) => was + 1);
  }, [activeKey]);

  return (
    <div
      ref={rowRef}
      // THE NAMES AND THE SIGNATURE SHARE ONE POSITIONED BOX, so the
      // wave's `left` is measured in the same space it is drawn in.
      className={
        // NO COLOUR HERE WHEN THIS IS THE BAND. This element is the
        // CONTENT of a horizontal scroller, and a block inside one
        // takes the SCROLLER'S width, not the content's: painted here,
        // it measured 393 against 837 of names, so scrolling 120 left
        // 120 pixels of bare white carrying white text — «يظهر شريط
        //  نحيف بلون مختلف… وتختفي التصنيفات». The scroller carries the
        // colour instead.
        // `w-full` SO THE FAR END IS THE ROW'S END. Without it the
        // row is only as wide as its names and `ms-auto` has nothing
        // to push a control against.
        "relative flex w-full items-end " + (band ? "px-3" : "")
      }
      data-testid={idPrefix}
    >
      <nav aria-label={label} className="flex items-end">
        {items.map((item, index) => {
          const active = item.key === activeKey;
          const opens = Boolean(item.children?.length);

          const entry =
            "whitespace-nowrap text-sm " +
            // FOUR PIXELS UNDER THE WORD — «المسافة بين الكلمة
            //  والكرتون كبيرة شوي… أربعة بدل ستة». The carton is 18
            // tall at the row's foot, so 22 of padding leaves four.
            (band ? "px-3 pb-3 pt-2.5 " : "px-4 pb-[22px] pt-2 ") +
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] " +
            // EVERY NAME IS BOLD, OPEN OR NOT — «أسماء الوجهات أنت
            //  حاطها رقيقة، وإذا صارت نشطة يصير عريض الخط، رغم أن
            //  الموجة تشير إلى النشط؛ خلّها على طول عريضة عشان تكون
            //  واضحة للمتصفّح».
            //
            // THE WAVE ALREADY ANSWERS «أين أنا». A weight that
            // changes with it says the same thing twice and pays for
            // it twice: the resting names were the thin ones, which
            // is to say the ones somebody is trying to READ were the
            // hardest to. What still separates the open name is its
            // ink — full against held-back — which costs nothing in
            // legibility.
            //
            // AND THE ROW DOES NOT RESIZE WHEN IT MOVES. One weight
            // for every name means every name keeps its width, so
            // the wave slides to a box that is where it was measured.
            "font-semibold " +
            (band
              ? active
                ? // THE OPEN CATEGORY IS THE ONE IN THE IDENTITY'S
                  // COLOUR. With no band to be white against, the
                  // orange IS the answer to «أين أنا» here, exactly
                  // as the wave is in the row above.
                  "text-accent-interactive"
                : "text-content-muted"
              : active
                ? "text-content"
                : "text-content-muted");

          const face = (
            <>
              {item.icon ? (
                <item.icon
                  aria-hidden="true"
                  // ORANGE WHETHER THE NAME IS OPEN OR NOT — «أيقونة
                  //  السوق خلّها باللون البرتقالي ثابتة». It is a
                  // MARK, not a state: it says which destination the
                  // market is, and a mark that dims when you leave
                  // the page reads as something switching off.
                  className="me-1.5 inline-block size-4 shrink-0 align-[-3px] text-accent-interactive"
                />
              ) : null}
              {item.label}
              {item.badge ? (
                <span
                  className={
                    "ms-1.5 inline-block rounded-full px-1.5 py-0.5 text-[11px] font-medium align-[1px] " +
                    // WHITE ON THE BAND, AMBER ON THE PAGE — the
                    // same two chips the tabs used, for the same
                    // reason: a chip must never be the colour of
                    // what it sits on.
                    (band
                      ? "bg-accent text-accent-foreground"
                      : "bg-accent text-accent-foreground")
                  }
                >
                  {item.badge}
                </span>
              ) : null}
              {/* THE ARROW IS THE WAVE, FILLED — «أسهم الفروع، ولكن
                   ليس مفرّغًا، يكون على شكل موجة يتناسب مع الشكل».
                   A chevron is two strokes borrowed from every other
                   interface; this is the same silhouette the row's
                   own signature is drawn from, solid and eight
                   pixels tall, and it turns over when the branches
                   are showing. */}
              {opens ? (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 8"
                  fill="currentColor"
                  className={
                    "ms-1.5 inline-block h-2 w-[14px] shrink-0 align-[1px] transition-transform motion-reduce:transition-none " +
                    (open?.key === item.key ? "rotate-180" : "")
                  }
                >
                  <path d="M0 0 H20 C 14 0 13.5 8 10 8 C 6.5 8 6 0 0 0 Z" />
                </svg>
              ) : null}
            </>
          );
          return (
            <span key={item.key} className="flex items-end">
              {index > 0 ? (
                // THE RULE BETWEEN TWO NAMES — «خط طولي بس لازم نظيف».
                // It parts the names and says nothing about which is
                // open; that is the wave's one job.
                <span
                  aria-hidden="true"
                  // LEVEL WITH THE WORDS, NOT WITH THE ROW'S FOOT —
                  // «الخط الفاصل جاي تحت والكلمتين فوق». The row aligns
                  // at the bottom so the wave can stand on its floor;
                  // the rule has to be lifted back to the middle of the
                  // text it parts.
                  className={
                    "w-px shrink-0 " +
                    (band
                      ? // THE PAGE'S OWN HAIRLINE, now that the rule
                        // stands on the page and not on a colour.
                        "mb-4 h-3 bg-line"
                      : "mb-[25px] h-3.5 bg-line")
                  }
                />
              ) : null}
              {/* ONE FACE, TWO CARRIERS. A plain name is a link; a
                  name with branches is a control that opens them —
                  and both wear the same classes, so the row reads as
                  one row and not as links with buttons among them. */}
              {opens ? (
                <button
                  type="button"
                  ref={(node) => {
                    itemRefs.current.set(item.key, node);
                  }}
                  aria-expanded={open?.key === item.key}
                  aria-haspopup="true"
                  aria-current={active ? "true" : undefined}
                  data-testid={`${idPrefix}-${item.key}`}
                  onClick={(event) => openItem(item, event.currentTarget)}
                  className={entry}
                >
                  {face}
                </button>
              ) : (
                <Link
                  ref={(node) => {
                    itemRefs.current.set(item.key, node);
                  }}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  data-testid={`${idPrefix}-${item.key}`}
                  className={entry}
                >
                  {face}
                </Link>
              )}{" "}
            </span>
          );
        })}
      </nav>

      {/* AND ONE CONTROL AT THE FAR END, on the names' own line.

          `ms-auto` PUSHES IT THERE in either direction: the row runs
          right to left in Arabic, so «far» is the left, and a
          physical margin would put it on the wrong side of one of
          the two languages.

          OUTSIDE THE `nav`, deliberately. It is not a destination,
          and a screen reader listing this row's places must not
          hear it among them. */}
      {action ? (
        <div className="ms-auto flex shrink-0 items-center pb-1">{action}</div>
      ) : null}

      {/* THE WAVE — the open name's own width, sliding to the next.
          `left` and `width` are measured, so a renamed page moves it
          without anybody editing a number. */}
      {band ? null : (
        <span
          aria-hidden="true"
          data-testid={`${idPrefix}-wave`}
          className={
            "pointer-events-none absolute bottom-0 " +
            (placed
              ? "transition-[left,width] duration-500 ease-[cubic-bezier(.5,0,.3,1)] motion-reduce:transition-none "
              : "") +
            (band ? "h-[9px]" : "h-[11px]")
          }
          style={{
            left: box?.left ?? 0,
            width: box?.width ?? 0,
            opacity: box ? 1 : 0,
          }}
        >
          <svg
            viewBox="0 0 100 20"
            preserveAspectRatio="none"
            className="block h-full w-full"
            aria-hidden="true"
          >
            <path
              d="M0 20 C 25 20, 30 4, 50 4 C 70 4, 75 20, 100 20 Z"
              fill={
                band
                  ? "var(--color-on-primary)"
                  : "var(--color-accent-interactive)"
              }
            />
          </svg>
        </span>
      )}

      {/* THE CARTON, CENTRED ON THE OPEN NAME — the owner's drawing.
          Three faces with orange seams and a 0.6 outline: on the wave
          it reads by its seams, and on the white bar the outline is
          what keeps it from dissolving. */}
      {band ? null : (
        <span
          aria-hidden="true"
          data-testid={`${idPrefix}-carton`}
          className={
            "pointer-events-none absolute bottom-0 size-[18px] " +
            (placed
              ? "transition-[left,transform] duration-500 ease-[cubic-bezier(.5,0,.3,1)] motion-reduce:transition-none"
              : "")
          }
          style={{
            left: box ? box.left + box.width / 2 - 9 : 0,
            transform: `rotate(-${turns * 360}deg)`,
            opacity: box ? 1 : 0,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="block h-full w-full"
            aria-hidden="true"
          >
            <g
              stroke="var(--color-accent-interactive)"
              strokeWidth="0.6"
              strokeLinejoin="round"
              fill="var(--color-surface)"
            >
              <path d="M12 2.6 L21.8 8.2 L12 13.8 L2.2 8.2 Z" />
              <path d="M2.2 9.4 L11.4 14.6 L11.4 21.4 L2.2 16.2 Z" />
              <path d="M21.8 9.4 L12.6 14.6 L12.6 21.4 L21.8 16.2 Z" />
            </g>
            {/* The tape, cut out of the lid and folded over one side —
              from the owner's own carton. */}
            <path
              d="M15.6 4.7 L17.9 6 L8.2 11.6 L8.2 15.4 L5.9 14.1 L5.9 10.3 Z"
              fill="var(--color-accent-interactive)"
            />
          </svg>
        </span>
      )}

      {/* WHAT THE OPEN NAME HOLDS.

          AS WIDE AS ITS WIDEST ENTRY AND NO MORE — «خلّه عرضه فرع
           واحد وليس فرعين، قابل للتمدّد إذا أضفنا فروعًا أكثر
           مستقبلًا». `w-max` is exactly that, with a floor so a
          two-letter name is still a target and a ceiling so a long
          one cannot span the screen.

          AND IT IS THE IDENTITY, DARKENED — «أحسّه لو جاي شفاف مائل
           للأسود، البرتقالي هذا». Not a white card: a white card
          arriving from another design is a second surface. This is
          the platform's own orange taken down and left slightly
          transparent, so what is under it reads through.

          DRAWN IN THE BODY, because the row usually sits inside a
          horizontal scroller and `overflow-x: auto` computes
          `overflow-y` to `auto` as well — a panel drawn here would
          be cut off at the row's own floor. */}
      {open && typeof document !== "undefined"
        ? createPortal(
            <ul
              ref={panelRef}
              data-testid={`${idPrefix}-panel`}
              style={{ left: open.left, top: open.top }}
              className={
                "fixed z-50 flex w-max min-w-[7rem] max-w-[70vw] " +
                "list-none flex-col rounded-b-card bg-band-panel p-1 " +
                "shadow-overlay backdrop-blur-sm " +
                "[&>li+li]:border-t [&>li+li]:border-band-panel-line"
              }
            >
              {/* The opened name stays reachable where it is a place
                  of its own: having branches must not be what makes a
                  category impossible to open. A console section is
                  not such a place, and passes no label. */}
              {panelLeadLabel ? (
                <li>
                  <Link
                    href={open.href}
                    className="block truncate rounded-md px-3 py-2 text-sm font-semibold text-primary-foreground"
                  >
                    {panelLeadLabel}
                  </Link>
                </li>
              ) : null}
              {/* A BRANCH, AND ITS OWN BRANCHES UNDER IT.

                  ONE PANEL, NOT A SECOND ONE THAT FLIES OUT. A
                  submenu opening from a submenu is a hover target
                  on a desktop and nothing at all on a finger; the
                  levels are shown INSIDE the panel instead, set in
                  from the branch above them. */}
              {open.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={child.href}
                    className="block truncate rounded-md px-3 py-2 text-sm text-primary-foreground"
                  >
                    {child.label}
                  </Link>
                  {child.children && child.children.length > 0 ? (
                    <ul className="list-none">
                      {child.children.map((leaf) => (
                        <li key={leaf.id}>
                          <Link
                            href={leaf.href}
                            className="block truncate rounded-md px-3 py-2 ps-7 text-sm text-primary-foreground opacity-80"
                          >
                            {leaf.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
