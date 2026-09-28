import type { PortalBarLinks } from "@/components/portal/portal-page-bar";

/**
 * WHAT THE OPEN TAB'S STRIP CARRIES IN THE BUYER'S PORTAL, per address.
 *
 * The same idea as the supplier's table and a separate file on purpose:
 * these are the BUYER'S routes, and one table serving two portals would
 * have to be read with a portal in mind before any line of it made
 * sense.
 *
 * IT CARRIES NO WAY BACK, and that is a decision this portal already
 * took: «the buyer's deep pages draw their own way back, and a second
 * trail above the first would be two answers to one question» — which
 * is why `TraderChrome` passes no breadcrumb either. Every record's
 * page here opens with its own trail, and putting the same link in the
 * strip put it on screen twice, four pixels apart. The supplier's strip
 * carries a back link because the supplier's FORMS have none of their
 * own; these pages do.
 *
 * SO WHAT IS LEFT IS ONE ACTION. The supplier's strip carries «إضافة
 * منتج» because a supplier CREATES the things in their lists; a buyer's
 * lists are things that happened to them — orders placed, disputes
 * opened, returns owed — and none of them starts from a button above a
 * list. What a buyer starts is a purchase, and that begins in the
 * market.
 *
 * EVERY OTHER PAGE GETS AN EMPTY STRIP, which is correct: the strip is
 * the sheet's top edge first and a place for controls second.
 */

export interface TraderBarLabels {
  /** «تصفّح المنتجات» — the market, from the page a buyer lands on. */
  browseOffers: string;
  /** «العودة إلى المنتجات» — from one offer's own screen. */
  backToList: string;
}

/**
 * Reads one path and says what the strip shows on it.
 *
 * MATCHED ON THE PART AFTER THE PORTAL'S OWN PREFIX, so the locale and
 * the base path never enter the patterns — a portal moved or a locale
 * added cannot silently stop matching.
 *
 * A trailing slash is tolerated because a link written with one is not
 * a different page.
 */
export function traderBarLinks(
  pathname: string,
  basePath: string,
  labels: TraderBarLabels,
): PortalBarLinks {
  const rest = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length).replace(/\/$/, "")
    : null;

  if (rest === null) return {};

  // THE ONE PLACE A BUYER STARTS SOMETHING. The dashboard is where they
  // land, so the market is the action worth having on it — and not on
  // the market itself, where it would point at the page it is on.
  // NOTHING AT THE FAR END OF THE DASHBOARD'S STRIP — «مكتوب في أقصى
  // اليسار تصفح المنتجات… احذف تصفح المنتجات».
  //
  // The market is one press away in the strip's own categories, where
  // «تصفّح المنتجات» now stands with a cart beside it. The same
  // destination at both ends of one strip is the same door twice.
  if (rest === "") {
    return {};
  }

  // ONE OFFER'S OWN SCREEN. The way back moves INTO the strip — «الشيء
  // الثاني مكتوب في الصفحة الرجوع إلى المنتجات وماخذة حيز… تقدر تلغي
  // التصنيفات من الشريط إذا دخلت تفاصيل المنتج وتحط مكانها عودة».
  //
  // The page had a line of its own for this, above the cards, costing a
  // row of vertical space to say one word. The strip is already there
  // and already carries a back link on every form in this portal.
  if (rest.startsWith("/opportunities/")) {
    return { back: { href: `${basePath}/opportunities`, label: labels.backToList } };
  }

  return {};
}
