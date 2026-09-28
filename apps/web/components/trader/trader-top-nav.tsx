"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FolderTabNav } from "@/components/portal/folder-tab-nav";
import type { PortalNavMap } from "@/components/portal/portal-nav";
import type { PortalTopNavLabels } from "@/components/portal/portal-top-nav";

/**
 * THE BUYER'S NAVIGATION — its order, its strip, and nothing else.
 *
 * «اجعل تصميم لوحة المشتري نفس لوحة المورد من حيث التصميم فقط» — so the
 * drawing is `FolderTabNav`, the same file the supplier's row is drawn
 * by, and what this contributes is which pages are tabs and in what
 * order.
 *
 * THE ROUTES DID NOT MOVE. «من حيث التصميم فقط»: every segment under
 * `/trader` is the one it already was, every page renders the content it
 * already rendered, and nothing was merged into anything. What changed
 * is that the reader reaches them from a row of tabs instead of three
 * panels that had to be opened first.
 */

/**
 * THE ORDER, BY PAGE KEY.
 *
 * EVERY GROUP FLATTENED — «إذا كان لديه أقسام فيها أقسام منبثقة يحوّلها
 * جميعًا إلى ألسنة». The buyer's map had three of them: «السوق» holding
 * one page, «الطلبات» holding four, «الحساب» holding two. A section
 * holding a single page is a click that buys nothing, and the other two
 * put a panel between the reader and every list they open all day.
 *
 * AND THREE OF THOSE TABS BECAME ONE — «المتابعة»: «ألغِ ألسنتها
 * وجمّعها كبطاقات في صفحة المتابعة». The disputes, the returns and the
 * product reports are not destinations; they are what a buyer is
 * waiting on, and three tabs meant three chances to miss the one with
 * something in it.
 *
 * THE ORDER FOLLOWS THE DAY, which is the order the map already
 * declared: what is on offer now, then what was bought, then what went
 * wrong with it, then the company's own records.
 *
 * «الإشعارات» IS NOT IN THE ROW. It has a bell of its own at the far
 * end of the same row — «نكتفي بأيقونة الإشعارات كرابط للصفحة» — and a
 * tab beside that bell would be a second door into one room. The page
 * is untouched and still reachable.
 */
export const TRADER_TAB_ORDER = [
  "dashboard",
  // «أضف كلمة السوق في المشتري بجانب الرئيسية» — second, where the
  // visitor's own row puts it, and for the same reason: it is the
  // one place on this front that is not the buyer's own paperwork.
  "opportunities",
  "orders",
  "followUp",
  // «انقل بيانات المنشأة من الشريط العلوي إلى داخل أيقونة المستخدم
  // بمسمّى بياناتي» — so it is no longer a tab. The page and its route
  // are untouched; only the way in moved.
] as const;

export function TraderTopNav({
  basePath,
  map,
  labels,
  brand,
  alert,
  controls,
  pathname: given,
  bell,
  searchLabels,
  drawerExtra,
  mobileControls,
}: {
  basePath: string;
  map: PortalNavMap;
  labels: PortalTopNavLabels;
  /** The path, when a caller already holds it. It reads its own otherwise. */
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
  /** The bell, already rendered — it is a Server Component. */
  bell?: ReactNode;
  /**
   * The categories, the way into the whole list and the search icon —
   * already built. «وأضف في لسان السوق في صفحة المشتري التصنيفات».
   *
   * It reads the taxonomy and the operator's chosen roots, which only a
   * Server Component can do, so the layout builds it and this decides
   * which tab it belongs to.
   */
  /**
   * THE SEARCH FIELD, already rendered — see `PortalSearch`. It is
   * built on the server because its words are translated there.
   */
  /** The search field's words and destination - see FolderTabNav. */
  searchLabels?: {
    action: string;
    placeholder: string;
    label: string;
    submitLabel: string;
  };
  /** The way into the market, already rendered - see PortalMarketLink. */
  drawerSearch?: ReactNode;
  drawerExtra?: ReactNode;
  /**
   * THE LANGUAGE AND THE WAY IN, FOR THE NARROW ROW — a SECOND
   * `RowControls`, never the wide row's node. See `FolderTabNav`.
   */
  mobileControls?: ReactNode;

}) {
  const read = usePathname();
  const pathname = given ?? read;


  return (
    <FolderTabNav
      portal="trader"
      basePath={basePath}
      map={map}
      labels={labels}
      tabOrder={TRADER_TAB_ORDER}
      brand={brand}
      alert={alert}
      controls={controls}
      searchLabels={searchLabels}
      drawerExtra={drawerExtra}
      mobileControls={mobileControls}
      pathname={pathname}
      bell={bell}
    />
  );
}
