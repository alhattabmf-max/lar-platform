"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Boxes, ChevronDown } from "lucide-react";

/**
 * The category bar under the top bar.
 *
 * Built from the REAL taxonomy — active root nodes in the order an
 * administrator set, each with its own children. Nothing here is a
 * hardcoded category or a typed URL: every destination is constructed
 * from a node id.
 *
 * ONE CONTROL, THREE INPUT METHODS. A root with children is a button
 * that reveals its submenu:
 *
 *   - Pointer: hovering the group opens it, leaving closes it.
 *   - Touch: hover does not exist, so the button opens it on tap. This
 *     is why the root is a BUTTON and not a link — a link that also had
 *     to reveal a menu would either navigate before the menu could be
 *     read or need a second tap nobody expects.
 *   - Keyboard: Enter or Space on the focused button opens it, Tab moves
 *     through the entries, and Escape closes it and returns focus to the
 *     button. Focus leaving the group closes it too.
 *
 * A root with NO children is a plain link, because there is nothing to
 * open and a button that only navigates is a worse link.
 */
export interface CategoryNavItem {
  id: string;
  label: string;
  href: string;
  /**
   * WHAT IS FILED UNDER IT, to whatever depth the tree has.
   *
   * RECURSIVE, because the catalogue is: a branch may hold
   * branches of its own, and a flat list here was the reason a
   * third-level category never reached a buyer.
   */
  children: CategoryNavItem[];
}

export interface CategoryNavProps {
  items: CategoryNavItem[];
  /**
   * WHERE IT IS STANDING.
   *
   * `bar` — its own white band under the top bar, which is what the
   * public site wore before the tabs.
   *
   * `strip` — inside the market tab's own orange strip: no band of its
   * own, no border, no home link (the tab beside it IS home), and the
   * ink the platform pairs with that fill. «وفي شريط السوق حط التصنيفات
   * وعرض الكل».
   */
  tone?: "bar" | "strip";
  /** Omitted in the strip: the row of tabs already carries home. */
  homeLabel?: string;
  homeHref?: string;
  /**
   * "View all" — the way into the full offers list with its filters.
   *
   * It lives HERE and nowhere else. It used to sit beside a heading on
   * the landing page, which put the same destination in two places and
   * meant a reader had to look in a different spot depending on which
   * page they were on. In the bar it is in the same place on every
   * page, second after Home and before the real categories.
   */
  viewAllLabel: string;
  viewAllHref: string;
  navLabel: string;
  /**
   * What the FIRST entry of an open category says — «عند عرض التصنيفات
   * يظهر اسم التصنيف، لا تكرّر اسمه، واكتب بدله جميع المنتجات».
   *
   * The entry exists so a category WITH branches is still choosable in
   * its own right; it used to repeat the category's name, directly
   * under the button already carrying it. Two identical words, four
   * pixels apart, and only one of them navigated.
   */
  allInCategoryLabel: string;
  /** "Show {name} subcategories", already carrying a {name} placeholder. */
  openTemplate: string;
}

export function CategoryNav({
  items,
  tone = "bar",
  homeLabel,
  homeHref,
  viewAllLabel,
  viewAllHref,
  navLabel,
  openTemplate,
  allInCategoryLabel,
}: CategoryNavProps) {
  /**
   * Hover and explicit opening are tracked SEPARATELY, and a menu is
   * open when either says so.
   *
   * One shared flag does not work. A click is preceded by a pointer
   * entering, so "hover opens, click toggles" means the enter opens the
   * menu and the click that follows immediately shuts it — a touch or
   * keyboard user can never get in, because for them the click is the
   * only way in. Two pieces of state cannot fight like that.
   */
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const openId = pinnedId ?? hoveredId;
  const groupRefs = useRef(new Map<string, HTMLLIElement>());

  const strip = tone === "strip";

  /**
   * ONE ROW IN AN OPEN CATEGORY — «حاول تقلّل الحشو أكبر قدر ممكن بين
   * الأسماء في الإطار المنبثق، لأني أشوف مسافة كبيرة».
   *
   * IT STOOD AT `min-h-nav`: 44px, the reach a destination in a RAIL
   * is owed. These are not rail entries — they are lines of a menu
   * that opened under a pointer, they carry no icon and no badge, and
   * at 44 a three-word category floated in the middle of a band twice
   * its own height.
   *
   * THIRTY-TWO IS THE PLATFORM'S OWN CONTROL HEIGHT, not a number
   * picked to be small, and it is the tightest this can go while every
   * row stays a target rather than a line of text. THE TRADE IS REAL
   * AND WORTH SAYING: the console's panel keeps 44 deliberately, so
   * this menu now offers a smaller target than that one does.
   *
   * THE HOVER IS THE CONSOLE'S, a six-per-cent mix of the identity
   * rather than the page grey: the page ground is the colour the
   * sheet is lying ON, so a row highlighted with it read as a hole.
   */
  const PANEL_ROW =
    "flex min-h-control items-center rounded-control px-3 py-1 text-sm " +
    "hover:bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-surface))] " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]";
  // ONE PLACE THE INK IS DECIDED. Written on every entry rather than
  // inherited, so a link added later cannot come out navy on orange.
  // AND IT DOES NOT MAKE THE STRIP TALLER THAN EVERY OTHER STRIP.
  //
  // `min-h-nav` is 44px, the touch target a destination in a RAIL is
  // owed. These links were that once — a band of their own under the
  // platform bar — and they carried the measure into the strip with
  // them: 44 of content inside a strip whose own floor is 44, plus its
  // four pixels of air top and bottom, came out at 52. Every other
  // tab's strip is 44, so the market's was eight pixels taller than
  // the rest of the platform for no reason a reader could see.
  //
  // IN THE STRIP THEY ARE CONTROLS, standing beside a 32px button, and
  // 32 is the height this system tested by touch and adopted for a
  // control. The strip then rests on its own 44px floor again.
  const entry =
    "inline-flex items-center px-3 text-sm font-medium hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
    // ON THE STRIP'S NAVY, white is the ink: 16.69:1. The accent's own
    // foreground — which served the strip while it was amber — measures
    // 1.07:1 here, and the muted slate 2.20.
    (strip
      ? "min-h-control text-primary-foreground"
      : "min-h-nav text-primary");

  // Escape closes whatever is open, wherever focus happens to be, and
  // returns focus to the control that opened it.
  useEffect(() => {
    if (openId === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const group = groupRefs.current.get(openId as string);
      setPinnedId(null);
      setHoveredId(null);
      group?.querySelector("button")?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openId]);

  return (
    <nav
      aria-label={navLabel}
      className={strip ? "min-w-0" : "border-b border-line bg-surface"}
      data-testid="category-nav"
    >
      <ul
        className={
          strip
            ? "flex list-none flex-wrap items-center gap-1"
            : "mx-auto flex max-w-6xl list-none flex-wrap items-center gap-1 px-4"
        }
      >
        {/* NO HOME LINK IN THE STRIP. The row of tabs above it carries
            «الرئيسية», and a second one four pixels below is the same
            destination said twice. */}
        {strip || !homeHref ? null : (
          <li>
            <Link href={homeHref} className={entry}>
              {homeLabel}
            </Link>
          </li>
        )}

        {/* Second, immediately after Home and before the real
            categories — the order is the same in both languages, and
            the direction of the bar is what mirrors it. */}
        <li>
          {/* GOODS, NOT A CART — «امسحها عربة تسوق، استبدلها بأيقونة
              منتجات فخمة وجميلة وكبّرها شوي عشان تبرز».
              
              A cart is what a buyer FILLS; this link opens the
              catalogue, and the two are different acts. Stacked boxes
              say goods, which is what is on the other side of it — and
              on a platform selling cement and steel by the pallet, a
              pallet of boxes is nearer the truth than a supermarket
              trolley.

              IT KEEPS ITS PLACE, second in the row and before the
              categories, in both languages — «ويكون مكان عرض الكل
              الحالي». Only the drawing changed. */}
          <Link
            href={viewAllHref}
            data-testid="nav-view-all"
            className={entry + " gap-1.5"}
          >
            {/* A SIZE ABOVE THE ROW'S — «وكبّرها شوي عشان تبرز». Twenty
                pixels against the sixteen every chevron beside it
                stands at, which is enough to lead the eye without
                touching the strip's height: the controls in it are 32
                tall and the strip's floor is 44, so five pixels of
                growth land in air that was already there. */}
            <Boxes aria-hidden="true" className="size-5 shrink-0" />
            {viewAllLabel}
          </Link>
        </li>

        {items.map((item) => {
          const isOpen = openId === item.id;

          if (item.children.length === 0) {
            return (
              <li key={item.id}>
                <Link href={item.href} className={entry}>
                  {item.label}
                </Link>
              </li>
            );
          }

          return (
            <li
              key={item.id}
              ref={(node) => {
                if (node) groupRefs.current.set(item.id, node);
                else groupRefs.current.delete(item.id);
              }}
              className="relative"
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() =>
                setHoveredId((current) =>
                  current === item.id ? null : current,
                )
              }
              // Focus does NOT open the menu — the button's click does,
              // and Enter or Space on a focused button IS a click. An
              // opener on focus fights the toggle: focusing would open
              // it and the click that followed would immediately shut
              // it, so a keyboard or touch user could never get in.
              //
              // Focus leaving the group still closes it, which is what
              // keeps a menu from being left hanging open behind you.
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  setPinnedId((current) =>
                    current === item.id ? null : current,
                  );
                }
              }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={openTemplate.replace("{name}", item.label)}
                onClick={() =>
                  setPinnedId((current) =>
                    current === item.id ? null : item.id,
                  )
                }
                className={entry + " gap-1"}
              >
                {item.label}
                {/* THE CONSOLE'S OWN ARROW — «استخدم السهم اللي في لوحة
                    الإدارة الذي يتحرّك إذا ضغطت على القسم».
                    It was a text glyph at ten pixels, which does not
                    turn and does not match anything else on the
                    platform. This is the same `ChevronDown` the
                    sections bar draws, with the same half-turn: the
                    arrow points AT the panel whether it is open or
                    shut, which is what makes it a state and not a
                    decoration. */}
                <ChevronDown
                  aria-hidden="true"
                  // THE CONSOLE'S OWN CLASSES, verbatim — «استخدم السهم
                  // اللي في لوحة الإدارة الذي يتحرّك».
                  //
                  // A NOTE FOR WHOEVER MEASURES THIS NEXT: on an SVG in
                  // this browser `getComputedStyle(...).transform` reads
                  // back the identity matrix even while the element is
                  // visibly turned. The class works; the reading does
                  // not. Confirm this one with a screenshot, never with
                  // a computed style.
                  className={`size-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen ? (
                /* THE CONSOLE'S PANEL — «اعتمد نفس فكرة الإطارات
                   المنبثقة من الأقسام في شريط واجهة الإدارة».
                   Anchored to the item's inline START so it opens
                   rightwards in English and leftwards in Arabic with no
                   direction check, and squared at the head where it
                   meets the opener so the two read as one piece. */
                <ul className="absolute start-0 top-full z-50 flex min-w-56 list-none flex-col rounded-b-card border border-line bg-surface p-1 shadow-card">
                  {/* The parent itself stays reachable: choosing a
                      category with children must not become impossible
                      just because it has them. */}
                  <li>
                    <Link
                      href={item.href}
                      className={PANEL_ROW + " font-medium text-primary"}
                    >
                      {allInCategoryLabel}
                    </Link>
                  </li>
                  {/* A BRANCH, AND ITS OWN BRANCHES UNDER IT.

                      ONE PANEL, NOT A SECOND ONE THAT FLIES OUT.
                      A submenu opening from a submenu is a hover
                      target on a desktop and nothing at all on a
                      finger; the levels are shown INSIDE the panel
                      instead, set in from the branch above them,
                      which is how a tree has always said what is
                      under what. */}
                  {item.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={child.href}
                        className={PANEL_ROW + " text-content"}
                      >
                        {child.label}
                      </Link>
                      {child.children.length > 0 ? (
                        <ul className="list-none">
                          {child.children.map((leaf) => (
                            <li key={leaf.id}>
                              <Link
                                href={leaf.href}
                                className={
                                  PANEL_ROW + " ps-7 text-content-muted"
                                }
                              >
                                {leaf.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
