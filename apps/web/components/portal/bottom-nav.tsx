"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface BottomNavItem {
  /** Matched against the open page, and used as the React key. */
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * THE DESTINATIONS, AT THE FOOT OF THE SCREEN.
 *
 * «راجعت أغلب تطبيقات الجوال لقيت فيها شريطين ثابتين، واحد أعلى وواحد
 *  أسفل.» The top bar had grown to three stacked rows and 153 pixels of
 * a phone's screen before the banner; the destinations came down here,
 * where the thumb already is, and the top went back to one row.
 *
 * SADE — PLAIN, NO TAB SHAPE. «الشريط السفلي سادة بدون لسان»: the
 * folder tab stays in ONE place, the bar at the top, where it answers
 * «أين أنت». A second tab down here would give one shape two jobs in a
 * single screen. So "you are here" is said in INK — the open
 * destination wears the accent, the rest are the same white held back —
 * and the shape says nothing at all.
 *
 * «المنتجات» IN THE MIDDLE, on both fronts. The visitor gets three
 * items and the buyer five, and the middle of each is the catalogue:
 * it is the one destination everybody came for, and it is the same
 * place in the bar whichever front you are signed into.
 *
 * THE SAFE AREA IS NOT DECORATION. A modern iPhone reserves the bottom
 * ~34 pixels for its own gesture bar; without `env(safe-area-inset-
 * bottom)` the last row of anything fixed to the bottom is half
 * untappable, and no amount of testing in a desktop browser shows it.
 *
 * IT IS `fixed`, NOT `sticky`, so it stands over the page rather than
 * at the end of it — and the page carries bottom padding of its own so
 * nothing is left underneath it. See `PortalChrome`.
 */
export function BottomNav({
  items,
  sheet,
  sheetLabels,
  label,
}: {
  items: readonly BottomNavItem[];
  /**
   * WHAT THE LAST ITEM OPENS, when it opens something.
   *
   * The buyer's «حسابي» is not a page, it is «بياناتي» and «خروج» —
   * the two rows the account menu holds in the wide bar. They arrive
   * BUILT because signing out is a Server Component's business (the
   * company and the console sign out through different endpoints), and
   * because the account page has no sign-out of its own: dropping the
   * menu without this would leave a buyer on a phone with no way out.
   *
   * The visitor passes none — the way in is a link to the sign-in page
   * and there is nothing behind it to open.
   */
  sheet?: ReactNode;
  sheetLabels?: { open: string; close: string };
  /** The bar's own accessible name. */
  label: string;
}) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  /**
   * WHICH ITEM IS OPEN.
   *
   * THE LONGEST MATCH WINS, and that is the whole rule: `/ar-SA/trader`
   * is a prefix of every page in the portal, so a plain `startsWith`
   * would light «الرئيسية» on all of them. The item whose href is the
   * longest prefix of the current path is the one you are inside.
   */
  const activeKey = items.reduce<{ key: string | null; len: number }>(
    (best, item) => {
      const hit =
        pathname === item.href || pathname.startsWith(`${item.href}/`)
          ? item.href.length
          : item.href.includes("?") && pathname === item.href.split("?")[0]
            ? item.href.length
            : 0;
      return hit > best.len ? { key: item.key, len: hit } : best;
    },
    { key: null, len: 0 },
  ).key;

  const cell =
    "flex flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-1 text-[11px] " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]";

  return (
    <>
      {/* THE SHEET RISES FROM THE BAR, not from the top of the screen,
          because that is where the control that opened it stands. It is
          in the document whether open or shut so `aria-controls` names
          something real — the same correction the navigation drawer
          needed. */}
      {sheet ? (
        <div
          id="bottom-nav-sheet"
          hidden={!sheetOpen}
          data-testid="bottom-nav-sheet"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:hidden"
        >
          <div className="flex justify-end p-1">
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label={sheetLabels?.close ?? ""}
              className="inline-flex min-h-nav w-11 items-center justify-center rounded-control text-content"
            >
              <X aria-hidden="true" className="size-control" />
            </button>
          </div>
          <div
            className="flex flex-col pb-2"
            onClickCapture={() => setSheetOpen(false)}
          >
            {sheet}
          </div>
        </div>
      ) : null}

      <nav
        aria-label={label}
        data-testid="bottom-nav"
        className="fixed inset-x-0 bottom-0 z-50 flex min-h-[56px] items-stretch border-t border-white/10 bg-primary pb-[env(safe-area-inset-bottom)] lg:hidden"
        style={{ ["--color-focus-ring" as string]: "var(--color-on-primary)" }}
      >
        {items.map((item) => {
          const active = item.key === activeKey;
          const Icon = item.icon;

          // THE LAST ITEM MAY BE A DOOR RATHER THAN A DESTINATION.
          const opensSheet = Boolean(sheet) && item.key === "account";

          const inner = (
            <>
              <Icon aria-hidden="true" className="size-5 shrink-0" />
              <span className="max-w-full truncate">{item.label}</span>
            </>
          );

          // THE OPEN ONE WEARS THE ACCENT; the rest are the bar's own
          // white, held back by opacity rather than by a paler token —
          // an alpha modifier on a colour this config backs with `var()`
          // produces a value the browser discards, and there is a guard
          // in this repo that says so by name.
          const tone = active
            ? "text-accent"
            : "text-primary-foreground opacity-70";

          return opensSheet ? (
            <button
              key={item.key}
              type="button"
              aria-expanded={sheetOpen}
              aria-controls="bottom-nav-sheet"
              onClick={() => setSheetOpen((was) => !was)}
              data-testid={`bottom-nav-${item.key}`}
              className={`${cell} ${tone}`}
            >
              {inner}
            </button>
          ) : (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={() => setSheetOpen(false)}
              data-testid={`bottom-nav-${item.key}`}
              className={`${cell} ${tone}`}
            >
              {inner}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
