import {
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Settings,
  Store,
  Tag,
} from "lucide-react";
import type { PortalNavMap } from "@/components/portal/portal-nav";

/**
 * WHAT IS IN THE SUPPLIER'S PORTAL, AND WHERE IT SITS.
 *
 * ONLY ROUTES THAT EXIST. Every segment here is a page already served
 * under `/[locale]/supplier`; `supplier-shell.test.tsx` walks this list
 * against the filesystem, so a link that 404s cannot ship and a page
 * added without a link is caught the same way.
 *
 * ONLY THE SUPPLIER'S OWN. Nothing from the console and nothing from
 * the buyer's portal appears here, and nothing can: the shared sidebar
 * renders the map it is given and knows of no other.
 *
 * THE BANK ACCOUNT AND THE BRANCHES ARE NOT SEPARATE DESTINATIONS.
 * They used to be two read-only screens that could change nothing;
 * both are now cards inside «بيانات المنشأة», which is where a
 * supplier completes its record. Listing them again in the sidebar
 * would send somebody to a second place for the same thing.
 *
 * BILLING KEEPS ITS OWN ENTRY, because it is a different concern and
 * is still entered only after approval.
 *
 * THE SEGMENTS ARE UNCHANGED. `replacement-obligations` keeps its path
 * even though the label reads «الاستبدالات»: a visible name is not a
 * route.
 */
export const SUPPLIER_PORTAL_MAP: PortalNavMap = {
  root: "supplier",
  home: { key: "dashboard", segment: "", icon: LayoutDashboard },
  groups: [
    {
      key: "catalogue",
      icon: Store,
      // ONE DESTINATION. A supplier's catalogue and their offers were
      // two lists showing the same items — one with the terms, one
      // without — so knowing anything meant visiting both. They are one
      // list now, and the old segment forwards to it.
      pages: [
        { key: "products", segment: "products", icon: Boxes, marked: true },
        // «عروضي» — the offers made ON those products, and a tab of its
        // own beside them. A product is a thing the supplier keeps; an
        // offer is a thing the market can see. They were merged into one
        // list for a while and the merge is what this undoes.
        { key: "opportunities", segment: "opportunities", icon: Tag },
      ],
    },
    {
      key: "orders",
      icon: ClipboardList,
      pages: [
        { key: "orders", segment: "orders", icon: ClipboardList },
        // «المتابعة» — ONE DESTINATION FOR THREE. The payouts, the
        // disputes and the returns were a tab each; none of them is a
        // place a supplier GOES, they are things that happen to them,
        // and three tabs meant three chances to miss one. They are three
        // cards on one screen now, and the three old addresses forward
        // to it.
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
