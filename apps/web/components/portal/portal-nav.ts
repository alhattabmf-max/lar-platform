import type { LucideIcon } from "lucide-react";

/**
 * WHAT A PORTAL'S NAVIGATION IS, independent of which portal.
 *
 * WHY IT IS SHARED. Three portals now wear the same chrome — the
 * console, the buyer's and the supplier's — and "which page am I on,
 * and which section holds it" is the same question in all three. One
 * implementation means the current page is highlighted the same way,
 * a record's own screen belongs to its section the same way, and a
 * change to that rule cannot fix two portals and miss the third.
 *
 * WHAT IS NOT SHARED IS THE MAP. Each portal passes its own, and a map
 * only ever names segments under its own root. There is no way for a
 * console destination to appear in a buyer's sidebar, because nothing
 * in this module knows the console exists.
 *
 * THE SEGMENTS ARE NEVER INVENTED HERE. Every path a map names is a
 * route the portal already serves; the tests walk each map against the
 * filesystem so a link that 404s cannot ship.
 */

export interface PortalPage {
  /** Names the message key for this destination, within the portal's namespace. */
  key: string;
  /** Path under the portal root. `""` is the portal root itself. */
  segment: string;
  icon: LucideIcon;
  /**
   * SEGMENTS THIS TAB LIGHTS FOR WITHOUT BEING THEIR TAB.
   *
   * «عرض الكل يعرض لي السوق بدون ما يكون فيه لسان للسوق» — the market
   * kept its page and lost its tab, so a reader standing on it is on a
   * page no tab names. Unlit, the row says nothing and looks broken.
   *
   * IT IS A LIST AND NOT A FALLBACK. The first thing tried was "when a
   * front has one tab, that tab is always lit", which is true of the
   * visitor and useless to the buyer — and on either front it would
   * also light for the policies, the FAQ and the checkout, none of
   * which the tab has anything to do with. Naming the segments says
   * which pages a tab actually covers, and says it where anyone
   * changing the routes will read it.
   */
  covers?: readonly string[];
  /**
   * THE ONE DESTINATION IN THIS FRONT'S ROW THAT CARRIES A GLYPH.
   *
   * «الأيقونة اللي في عروضي في صفحة المورد أزلها، ما طلبتها، خلّها
   *  جنب منتجاتي.»
   *
   * IT WAS ASKED OF THE SEGMENT for one build — any page at
   * `opportunities` got the mark — and that is right for the
   * visitor and the buyer, where `opportunities` IS the catalogue,
   * and wrong for the supplier, where it is «عروضي»: what this
   * company is selling, not what there is to buy. The goods on the
   * supplier's front are «منتجاتي».
   *
   * SO THE FRONT SAYS WHICH, in the file that already says what its
   * destinations are. One per row: a glyph beside every name is a
   * row of pictures with captions.
   */
  marked?: boolean;
}

export interface PortalGroup {
  key: string;
  icon: LucideIcon;
  pages: readonly PortalPage[];
}

export interface PortalNavMap {
  /**
   * The URL segment that names this portal — `admin`, `trader`,
   * `supplier`. Used to find the portal's own root inside a full,
   * locale-prefixed pathname.
   */
  root: string;
  /**
   * The one page that stands alone above the groups.
   *
   * Not a group of one: a disclosure that opens to reveal a single link
   * is a press that gives nothing back.
   */
  home: PortalPage;
  groups: readonly PortalGroup[];
}

/** Every destination in a map, home first. */
export function portalPages(map: PortalNavMap): PortalPage[] {
  return [map.home, ...map.groups.flatMap((group) => group.pages)];
}

/** The part of a pathname that lies under the portal's root, or null. */
function underRoot(map: PortalNavMap, pathname: string): string | null {
  // A PORTAL WITH NO ROOT IS THE PUBLIC FRONT, whose pages hang
  // straight off the locale: `/ar-SA` and `/ar-SA/opportunities`.
  //
  // It cannot go through the marker search below. An empty root makes
  // the marker `"/"`, which matches at index 0 of every path, and the
  // character after it is then `a` of `ar-SA` rather than a separator —
  // so every lookup returned null and no tab was ever the current one.
  //
  // The locale is always the FIRST segment, and this app has no route
  // that omits it, so what is under the root is simply what follows it.
  if (map.root === "") {
    const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
    return parts.slice(1).join("/");
  }

  const marker = `/${map.root}`;
  const at = pathname.indexOf(marker);
  if (at === -1) return null;

  // The marker must end the path or be followed by a separator, or
  // `/traders` would be read as the trader portal.
  const after = pathname[at + marker.length];
  if (after !== undefined && after !== "/") return null;

  return pathname.slice(at + marker.length).replace(/^\/+|\/+$/g, "");
}

/**
 * Which page a pathname is on, and which group holds it.
 *
 * MATCHES THE LONGEST SEGMENT, not the first that is a prefix.
 * `/admin/products/reports` and `/admin/products` both begin with
 * `products`, and `/trader/orders/abc` is still the orders page — a
 * detail screen belongs to the section it was opened from, and its
 * highlighted sidebar entry has to say so.
 *
 * The portal root matches only exactly, or every path would be "home".
 */
export function locatePortalPage(
  map: PortalNavMap,
  pathname: string,
): { page: PortalPage; group: PortalGroup | null } | null {
  const rest = underRoot(map, pathname);
  if (rest === null) return null;
  if (rest === "") return { page: map.home, group: null };

  // A TAB'S COVERED PAGES, before the groups: the home tab is not in
  // any group, so a page it covers has nowhere else to be found.
  if (
    map.home.covers?.some(
      (segment) => rest === segment || rest.startsWith(`${segment}/`),
    )
  ) {
    return { page: map.home, group: null };
  }

  let best: { page: PortalPage; group: PortalGroup } | null = null;
  for (const group of map.groups) {
    for (const page of group.pages) {
      if (rest === page.segment || rest.startsWith(`${page.segment}/`)) {
        if (!best || page.segment.length > best.page.segment.length) {
          best = { page, group };
        }
      }
    }
  }

  return best;
}

/**
 * True when the path is BELOW a section page — a record's own screen
 * rather than the register that lists them.
 *
 * The chrome uses this to stand aside: a detail page knows the record's
 * name and the query the reader arrived from, and neither is derivable
 * from the route map.
 */
export function isPortalDetailPath(
  map: PortalNavMap,
  pathname: string,
): boolean {
  const rest = underRoot(map, pathname);
  if (rest === null || rest === "") return false;

  for (const group of map.groups) {
    for (const page of group.pages) {
      if (rest.startsWith(`${page.segment}/`)) return true;
    }
  }

  // A COVERED SEGMENT HAS RECORDS UNDER IT TOO. The market lost its tab
  // and kept its page, so `/opportunities/{id}` is below a segment no
  // GROUP names — and this returned false for the one screen a buyer
  // presses «متابعة الشراء» on.
  return (
    map.home.covers?.some((segment) => rest.startsWith(`${segment}/`)) ?? false
  );
}
