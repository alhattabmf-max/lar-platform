"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FolderTabNav } from "@/components/portal/folder-tab-nav";
import type { PortalNavMap } from "@/components/portal/portal-nav";
import type { PortalTopNavLabels } from "@/components/portal/portal-top-nav";
import {
} from "./supplier-bar-actions";

/**
 * THE SUPPLIER'S NAVIGATION — its order, its strip, and nothing else.
 *
 * THE DRAWING LIVES IN `FolderTabNav`. It was written here first, as a
 * deliberate copy of the shared bar so the design could not reach the
 * other panels by accident — «اعزل التعديل عن بقية اللوحات». The owner
 * has since asked for the buyer to wear it too, so the pixels moved to
 * one file and what stayed here is what is genuinely the supplier's:
 * which pages are tabs, in what order, and what their strip carries.
 *
 * THE CONSOLE IS STILL UNTOUCHED. It renders `PortalTopNav`, the shared
 * bar with the disclosure panels, because a portal takes this design by
 * handing its own chrome a `navSlot` — a decision taken in that
 * portal's file and nowhere else.
 */

/**
 * THE ORDER THE OWNER GAVE, by page key.
 *
 * BY KEY AND NOT BY SEGMENT, so a route that is renamed does not
 * silently drop a tab; and each key is looked up in the map at render,
 * so a page removed from the map leaves no dead tab behind.
 *
 * «عروضي» STANDS BESIDE «منتجاتي», and the two are not one thing said
 * twice. A PRODUCT is what the supplier keeps — a name, a picture, a
 * weight; an OFFER is what the market can see — a price, a quantity, a
 * clock. They were merged into a single list for a while, and a
 * supplier who wanted to record goods without selling them yet had
 * nowhere to put them.
 */
export const SUPPLIER_TAB_ORDER = [
  "dashboard",
  "products",
  "opportunities",
  "orders",
  // «المتابعة» — the payouts, the disputes and the returns, which were
  // three tabs of their own. None of the three is a place a supplier
  // goes; they are things that happen to them, and three tabs meant
  // three chances to miss one.
  "followUp",
  // «انقل بيانات المنشأة من الشريط العلوي إلى داخل أيقونة المستخدم
  // بمسمّى بياناتي» — so it is no longer a tab. The page and its route
  // are untouched; only the way in moved.
] as const;

export function SupplierTopNav({
  basePath,
  map,
  labels,
  brand,
  alert,
  controls,
  pathname: given,
  bell,
  searchLabels,
  mobileControls,
}: {
  basePath: string;
  map: PortalNavMap;
  labels: PortalTopNavLabels;
  /**
   * The path, when a caller already holds it.
   *
   * IT READS ITS OWN otherwise, and that is why the chrome hands this
   * component in as an ELEMENT rather than as a function that builds
   * one: a function-typed prop cannot cross the server boundary.
   */
  /**
   * THE TENANT'S MARK, already rendered, standing before the first tab.
   * «شِل الشعار من الشريط العلوي وحطّه قبل لسان الرئيسية».
   */
  brand?: ReactNode;
  /** «إجراء مطلوب», already rendered — it stands beside the bell. */
  alert?: ReactNode;
  /**
   * THE LANGUAGE AND THE WAY IN OR OUT, already rendered — see
   * `RowControls`. This row is the front's top bar now.
   */
  controls?: ReactNode;
  pathname?: string;
  /**
   * The bell, already rendered.
   *
   * «ونحط أيقونة الإشعارات موازية للألسنة في الجهة المقابلة» — it
   * belongs at the far end of this row rather than up in the platform's
   * bar. It arrives BUILT because it is a Server Component.
   */
  bell?: ReactNode;
  /**
   * THE SEARCH FIELD, already rendered — see `PortalSearch`. It is
   * built on the server because its words are translated there.
   */
  /**
   * THE NARROW ROW'S OWN CONTROLS — a SECOND instance, never the
   * wide row's node. See `FolderTabNav`.
   */
  mobileControls?: ReactNode;
  /** The search field's words and destination - see FolderTabNav. */
  searchLabels?: {
    action: string;
    placeholder: string;
    label: string;
    submitLabel: string;
  };
}) {
  const read = usePathname();
  const pathname = given ?? read;

  return (
    <FolderTabNav
      portal="supplier"
      basePath={basePath}
      map={map}
      labels={labels}
      tabOrder={SUPPLIER_TAB_ORDER}
      brand={brand}
      alert={alert}
      controls={controls}
      searchLabels={searchLabels}
      mobileControls={mobileControls}
      pathname={pathname}
      bell={bell}
    />
  );
}
