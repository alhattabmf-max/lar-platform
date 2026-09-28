import {
  Bell,
  Building2,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Boxes,
  Package,
  Settings,
} from "lucide-react";
import type { PortalNavMap } from "@/components/portal/portal-nav";

/**
 * WHAT IS IN THE BUYER'S PORTAL, AND WHERE IT SITS.
 *
 * ONLY ROUTES THAT EXIST. Every segment here is a page already served
 * under `/[locale]/trader`; `trader-shell.test.tsx` walks this list
 * against the filesystem, so a link that 404s cannot ship and a page
 * added without a link is caught the same way.
 *
 * ONLY THE BUYER'S OWN. Nothing from the console and nothing from the
 * supplier's portal appears here, and nothing can: the shared sidebar
 * renders the map it is given and knows of no other. The buyer has no
 * products screen, no settlements screen and no bank-account payout
 * screen of the supplier's kind, so none is named.
 *
 * THE SEGMENTS ARE UNCHANGED. This batch changed the chrome, not the
 * routes: `/trader` is still `/trader` and every path below it is the
 * one it already was.
 *
 * THE ORDER FOLLOWS THE DAY: what is happening now, then what was
 * bought, then what went wrong, then the company's own records.
 */
export const TRADER_PORTAL_MAP: PortalNavMap = {
  root: "trader",
  /**
   * AND THE MARKET IS A DESTINATION AGAIN — «أضف كلمة السوق في
   *  المشتري بجانب الرئيسية، لأن الشريط يطلع في الرئيسية».
   *
   * IT HUNG UNDER THE HOME TAB by `covers` for one design, back when
   * the row could hold only so many folder tabs and the categories
   * were a strip belonging to whichever tab was open. That is what
   * put a row of categories on the buyer's OWN dashboard, where
   * there is nothing to browse.
   *
   * THE ROW OF NAMES HAS ROOM, so the room it has is spent on saying
   * where the market is rather than on hiding it under something
   * else. Nothing about the route changed.
   */
  home: {
    key: "dashboard",
    segment: "",
    icon: LayoutDashboard,
  },
  groups: [
    {
      key: "market",
      icon: Boxes,
      pages: [
        { key: "opportunities", segment: "opportunities", icon: Boxes, marked: true },
      ],
    },
    {
      key: "orders",
      icon: Package,
      pages: [
        { key: "orders", segment: "orders", icon: ClipboardList },
        // «المتابعة» — ONE DESTINATION FOR THREE. The disputes, the
        // returns and the product reports were a tab each; not one of
        // them is a place a buyer GOES, they are things that happen to
        // them, and three tabs meant three chances to miss the one with
        // something waiting. They are three cards on one screen now, and
        // the three old addresses forward to it.
        { key: "followUp", segment: "follow-up", icon: ListChecks },
      ],
    },
    {
      key: "account",
      icon: Settings,
      pages: [
        { key: "notifications", segment: "notifications", icon: Bell },
        { key: "account", segment: "account", icon: Building2 },
      ],
    },
  ],
};
