"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Menu, X } from "lucide-react";
import {
  locatePortalPage,
  type PortalGroup,
  type PortalNavMap,
  type PortalPage,
} from "./portal-nav";

/**
 * A portal's navigation, across the top.
 *
 * ONE COMPONENT FOR THREE PORTALS. The console, the supplier's and the
 * buyer's all read a `PortalNavMap` and nothing else, so "which page am
 * I on and which group holds it" is answered once. There is no branch
 * in this file on which portal is rendering, and therefore no way for
 * one portal's destination to appear in another's bar.
 *
 * THE IDENTITY COLOUR, BENEATH THE WHITE BAR. The bar above holds who
 * you are and how to leave; this one holds where you can go. Two bands
 * of the same colour stacked on each other would read as one, which is
 * why the bar above is white on a workspace.
 *
 * THE ACTIVE ITEM IS UNDERLINED IN THE ACCENT, and the underline is
 * drawn on the item whether it is a page or the group holding one — so
 * a reader on a nested screen can still see which section they are in.
 * COLOUR IS NOT THE ONLY SIGNAL: the active item also carries
 * `aria-current`, and its label goes to full weight. An underline
 * distinguishable only by hue would say nothing to a reader who cannot
 * separate those hues.
 *
 * A GROUP IS A DISCLOSURE, NOT A LINK. It opens a panel of its pages —
 * a group is a heading, and making it navigate somewhere would send
 * people to a page they did not ask for. It opens on CLICK rather than
 * on hover: a hover menu is unusable by touch and hostile on a
 * trackpad, and there is no hover on the device half this platform is
 * read on.
 *
 * NOTHING SCROLLS SIDEWAYS. Above `lg` the groups sit in a row; below
 * it the whole thing collapses to one button that opens a panel, and
 * the panel is a column. A row of a dozen destinations squeezed onto a
 * telephone is the horizontal scroll this replaces.
 */

export interface PortalTopNavLabels {
  /** Names the `<nav>` landmark. */
  navLabel: string;
  openMenu: string;
  closeMenu: string;
  /** By group key. */
  groupNames: Record<string, string>;
  /** By page key. */
  pageNames: Record<string, string>;
  /** By page key; rendered beside the name when present. */
  pageBadges?: Record<string, string>;
}

export interface PortalTopNavProps {
  /** Where the portal lives, locale included: `/ar-SA/supplier`. */
  basePath: string;
  map: PortalNavMap;
  labels: PortalTopNavLabels;
  /** The current path, so the bar can say where the reader is. */
  pathname: string;
}

/**
 * EVERY DESTINATION IS FULLY LEGIBLE, and the active one is told apart
 * by weight and by the accent underline — never by being the only one
 * bright enough to read.
 *
 * THE DEFECT THIS REPLACED. The inactive items were
 * `text-primary-foreground/85`, and the token behind that class is
 * `var(--color-on-primary)` — a plain hex with no `<alpha-value>`
 * placeholder, so Tailwind's `/85` modifier could not build a colour
 * from it and the declaration was dropped. The items fell back to the
 * inherited `text-content`, which is near-black: measured at 1.07:1
 * against this navy band, which is to say invisible. Only the active
 * item, which never carried the modifier, could be read at all.
 *
 * There is no opacity here now. Full white is 16.69:1 on the identity
 * blue, and dimming a destination to signal "not current" would be
 * spending legibility on something the underline already says.
 */
const ITEM =
  "relative inline-flex min-h-nav items-center gap-1.5 whitespace-nowrap px-3 " +
  "text-sm text-primary-foreground " +
  "hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]";

const ITEM_ACTIVE = "font-semibold";

/**
 * The accent underline.
 *
 * Drawn as a positioned span rather than a `border-b`, so it hugs the
 * item's own width and sits flush with the bar's bottom edge whichever
 * direction the page reads — `inset-inline` is the logical property,
 * and it needs no `locale === "ar-SA"` anywhere.
 */
function ActiveUnderline() {
  return (
    <span
      aria-hidden="true"
      data-testid="nav-active-underline"
      className="pointer-events-none absolute bottom-0 start-0 end-0 h-0.5 bg-accent"
    />
  );
}

export function PortalTopNav({
  basePath,
  map,
  labels,
  pathname,
}: PortalTopNavProps) {
  const here = locatePortalPage(map, pathname);
  const activePageKey = here?.page.key ?? null;
  const activeGroupKey = here?.group?.key ?? null;

  // Which group's panel is open, and the whole bar's panel on a narrow
  // screen. One open at a time: two panels over each other is two
  // answers to one question.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const barRef = useRef<HTMLElement | null>(null);
  const drawerButtonRef = useRef<HTMLButtonElement | null>(null);

  // A NAVIGATION CLOSES WHAT OPENED IT. Without this the panel stays up
  // over the page that was just loaded, because Next keeps the client
  // component mounted across a route change within the same layout.
  useEffect(() => {
    setOpenGroup(null);
    setDrawerOpen(false);
  }, [pathname]);

  // CLICKING AWAY CLOSES IT, and so does Escape — the two ways a person
  // expects to dismiss something they opened. Escape returns focus to
  // the control that opened it, or it lands on the document body and
  // the next Tab starts from the top of the page.
  useEffect(() => {
    if (openGroup === null && !drawerOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) {
        setOpenGroup(null);
        setDrawerOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenGroup(null);
      if (drawerOpen) {
        setDrawerOpen(false);
        drawerButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openGroup, drawerOpen]);

  const hrefFor = (page: PortalPage) =>
    page.segment ? `${basePath}/${page.segment}` : basePath;

  const badge = (page: PortalPage) => {
    const text = labels.pageBadges?.[page.key];
    return text ? (
      <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
        {text}
      </span>
    ) : null;
  };

  /** The home link, which stands alone rather than inside a group. */
  const homeLink = (onNavigate?: () => void) => {
    const active = activePageKey === map.home.key;
    return (
      <Link
        href={hrefFor(map.home)}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        data-testid={`nav-page-${map.home.key}`}
        className={`${ITEM} ${active ? ITEM_ACTIVE : ""}`}
      >
        {labels.pageNames[map.home.key] ?? map.home.key}
        {active ? <ActiveUnderline /> : null}
      </Link>
    );
  };

  /** One group's pages, as links. Shared by the panel and the drawer. */
  const groupLinks = (group: PortalGroup, onNavigate?: () => void) =>
    group.pages.map((page) => {
      const active = activePageKey === page.key;
      return (
        <Link
          key={page.key}
          href={hrefFor(page)}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          data-testid={`nav-page-${page.key}`}
          className={
            // THE PLATFORM'S TOUCH TARGET, from the token. `py-2` gave
            // these 32px, which is below the 44px every other
            // destination on this platform offers and below what a
            // finger can reliably hit.
            "flex min-h-nav items-center justify-between gap-3 rounded-control px-3 py-2 text-sm " +
            // MIXED, NOT DIMMED. `bg-primary/5` resolves to
            // `var(--color-primary)` — a plain hex with no
            // `<alpha-value>` — so Tailwind builds nothing from the
            // modifier and the declaration is dropped: the row simply
            // never highlighted. Same cause as the text colour above.
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
    <nav
      ref={barRef}
      aria-label={labels.navLabel}
      data-testid="portal-top-nav"
      // THE FOCUS RING INVERTS, for the same reason it does on a brand
      // bar: the ring token IS the identity colour, so on this band it
      // would be navy on navy and a keyboard user would see nothing.
      // AND IT STICKS BELOW THE WHITE BAR, not at the top of the
      // viewport. The offset is that bar's own height token rather than
      // a typed number, so the two cannot drift apart when the control
      // height changes.
      style={{
        ["--color-focus-ring" as string]: "var(--color-on-primary)",
        top: "var(--nav-item-height)",
      }}
      className="sticky z-40 bg-primary"
    >
      {/*
        ONE ROW, WITH THE HOME LINK DRAWN ONCE.

        It used to be rendered inside both the wide layout and the
        narrow one, so it existed twice in the document — hidden by a
        breakpoint on one of them, but present, duplicated in the
        accessibility tree and found twice by anything looking it up.
        What differs between the two widths is the GROUPS, so only the
        groups are duplicated.
      */}
      <div className="flex w-full items-center gap-1 px-4 lg:px-6">
        {homeLink(() => setDrawerOpen(false))}

        {/* From `lg` up: the groups, in a row. */}
        <div className="hidden items-center gap-1 lg:flex">
          {map.groups.map((group) => {
            const open = openGroup === group.key;
            const active = activeGroupKey === group.key;
            return (
              <div key={group.key} className="relative">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-haspopup="true"
                  data-testid={`nav-group-${group.key}`}
                  onClick={() => setOpenGroup(open ? null : group.key)}
                  className={`${ITEM} ${active ? ITEM_ACTIVE : ""}`}
                >
                  <group.icon aria-hidden="true" className="size-4 shrink-0" />
                  {labels.groupNames[group.key] ?? group.key}
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                  {active ? <ActiveUnderline /> : null}
                </button>

                {open ? (
                  <div
                    data-testid={`nav-panel-${group.key}`}
                    // ANCHORED TO THE ITEM'S INLINE START, so it opens
                    // rightwards in English and leftwards in Arabic
                    // without a direction check.
                    className="absolute start-0 top-full z-50 min-w-56 rounded-b-card border border-line bg-surface p-1 shadow-card"
                  >
                    <div className="flex flex-col">
                      {groupLinks(group, () => setOpenGroup(null))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Below `lg`: one button, at the bar's inline end. */}
        <button
          ref={drawerButtonRef}
          type="button"
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? labels.closeMenu : labels.openMenu}
          data-testid="portal-menu-button"
          onClick={() => setDrawerOpen((was) => !was)}
          className="ms-auto inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control text-primary-foreground hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"
        >
          {drawerOpen ? (
            <X aria-hidden="true" className="size-control" />
          ) : (
            <Menu aria-hidden="true" className="size-control" />
          )}
        </button>
      </div>

      {drawerOpen ? (
        <div
          data-testid="portal-nav-drawer"
          // A COLUMN, AND THE PAGE'S OWN SCROLL. Capped at the viewport
          // so a portal with many destinations scrolls the panel rather
          // than the bar, and never sideways.
          className="max-h-[70vh] overflow-y-auto border-t border-line bg-surface px-2 py-2 lg:hidden"
        >
          {map.groups.map((group) => (
            <div key={group.key} className="py-1">
              <p className="flex items-center gap-2 px-3 py-1 text-xs font-medium uppercase tracking-wide text-content-muted">
                <group.icon aria-hidden="true" className="size-4 shrink-0" />
                {labels.groupNames[group.key] ?? group.key}
              </p>
              <div className="flex flex-col">
                {groupLinks(group, () => setDrawerOpen(false))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
