/**
 * WHAT THE OPEN TAB'S STRIP CARRIES, per address.
 *
 * The strip is drawn by the layout and the pages are drawn under it, so
 * the one thing they share is the path. This is the whole of the
 * mapping from a path to what the strip should hold on it — declared
 * once, in a file of its own, so it can be read at a glance and checked
 * against the routes that exist.
 *
 * IT HOLDS ONLY WHAT THE DELETED BARS HELD. The owner had a dark bar
 * above each list carrying its one action, and another above each
 * create form carrying the way back — «احذف الشريط اللي حطيته أنت
 * سابقًا». Those controls did not stop being needed when the bars went;
 * they moved up into the strip, which is the row the owner asked for
 * and the only one left.
 *
 * EVERY OTHER PAGE DRAWS ITS OWN WAY BACK, exactly as it did before,
 * and nothing here touches it. A route absent from this table gets an
 * empty strip, which is correct: the strip is the sheet's top edge
 * first and a place for controls second.
 */

import type { PortalBarLinks } from "@/components/portal/portal-page-bar";

export interface SupplierBarLabels {
  addProduct: string;
  chooseProduct: string;
  backToProducts: string;
  backToProduct: string;
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
export function supplierBarLinks(
  pathname: string,
  basePath: string,
  labels: SupplierBarLabels,
): PortalBarLinks {
  const rest = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length).replace(/\/$/, "")
    : null;

  if (rest === null) return {};

  // THE CATALOGUE — its one action is adding to it.
  if (rest === "/products") {
    return { action: { href: `${basePath}/products/new`, label: labels.addProduct } };
  }

  // THE OFFERS — an offer is made ON a product, so the action points at
  // the catalogue rather than at a form that would open by asking which
  // product this is about.
  if (rest === "/opportunities") {
    return { action: { href: `${basePath}/products`, label: labels.chooseProduct } };
  }

  if (rest === "/products/new") {
    return { back: { href: `${basePath}/products`, label: labels.backToProducts } };
  }

  // AN OFFER'S FORM, which lives under the product it is an offer on —
  // so the way back is that product, and its id is in the address.
  const offerForm = /^\/products\/([^/]+)\/offers\/new$/.exec(rest);
  if (offerForm) {
    return {
      back: {
        href: `${basePath}/products/${offerForm[1]}`,
        label: labels.backToProduct,
      },
    };
  }

  return {};
}
