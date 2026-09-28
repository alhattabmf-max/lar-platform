import {
  BellRing,
  Building2,
  ClipboardList,
  Database,
  FileText,
  FolderTree,
  HandCoins,
  Headphones,
  Images,
  Lightbulb,
  LayoutDashboard,
  Package,
  Palette,
  PencilRuler,
  Puzzle,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  Undo2,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import {
  locatePortalPage,
  type PortalGroup,
  type PortalNavMap,
  type PortalPage,
} from "@/components/portal/portal-nav";

/**
 * WHAT IS IN THE CONTROL PANEL, AND WHERE IT SITS.
 *
 * One list, in one file, because "which screens exist and how they are
 * grouped" is a single decision that the sidebar, the breadcrumb and the
 * tests all have to agree on. Three copies of it would disagree the
 * first time a screen moved.
 *
 * THE SEGMENTS ARE UNCHANGED. Every path here is one the portal already
 * served; nothing was renamed, moved or removed to fit the grouping.
 * `banners` is still `banners` even though the Arabic label it shows is
 * now «البنرات الإعلانية» — a visible name is not a route.
 *
 * The order is the approved one and is not alphabetical: it follows the
 * day — the marketplace, then what customers raise, then money, then how
 * the site presents itself, then the platform's own configuration, then
 * the records about the operators themselves.
 */

/** Keys already present in the `admin.nav` message namespace. */
export type ControlPanelPageKey =
  | "dashboard"
  | "companies"
  | "products"
  | "opportunities"
  | "orders"
  | "disputes"
  | "refunds"
  | "settlements"
  | "bankAccounts"
  | "invoicing"
  | "banners"
  | "content"
  | "policies"
  | "branding"
  | "settings"
  | "catalogue"
  | "taxonomy"
  | "outbox"
  | "adminUsers"
  | "audit";

export type ControlPanelGroupKey =
  "market" | "orders" | "finance" | "content" | "system" | "security";

export interface ControlPanelPage extends PortalPage {
  key: ControlPanelPageKey;
  icon: LucideIcon;
}

export interface ControlPanelGroup extends PortalGroup {
  key: ControlPanelGroupKey;
  icon: LucideIcon;
  pages: readonly ControlPanelPage[];
}

/**
 * The one page that stands alone above the groups.
 *
 * Not a group of one: a disclosure control that opens to reveal a single
 * link is a step that costs a press and gives nothing back.
 */
export const CONTROL_PANEL_HOME: ControlPanelPage = {
  key: "dashboard",
  segment: "",
  icon: LayoutDashboard,
};

export const CONTROL_PANEL_GROUPS: readonly ControlPanelGroup[] = [
  {
    key: "market",
    icon: Store,
    pages: [
      { key: "companies", segment: "companies", icon: Building2 },
      { key: "products", segment: "products", icon: Package },
      // BESIDE THE PRODUCTS IT CLASSIFIES, not among the reference
      // tables. A category is the shape of the catalogue; a region
      // and a sales unit are lookups.
      { key: "taxonomy", segment: "taxonomy", icon: FolderTree },
      { key: "opportunities", segment: "opportunities", icon: Lightbulb },
    ],
  },
  {
    key: "orders",
    icon: Headphones,
    pages: [
      { key: "orders", segment: "orders", icon: ClipboardList },
      { key: "disputes", segment: "disputes", icon: Scale },
      { key: "refunds", segment: "refunds", icon: Undo2 },
    ],
  },
  {
    key: "finance",
    icon: WalletCards,
    pages: [
      { key: "settlements", segment: "settlements", icon: HandCoins },
      // NO BANK ACCOUNTS SCREEN — «أبغى ألغي صفحة الحسابات البنكية،
      // ما أحتاجها، لأن كل حساب يخصّ مورّدًا فبالضرورة أدخل للمورّد
      // وتفاصيله».
      //
      // It was a queue for a decision that no longer exists: an
      // account has not been approved on its own since the review
      // became one request over the supplier's whole record. What
      // it showed — the holder, the bank, the last four digits —
      // is on the supplier's own page now, beside the button that
      // decides it.
      { key: "invoicing", segment: "invoicing", icon: ReceiptText },
    ],
  },
  {
    key: "content",
    icon: PencilRuler,
    pages: [
      { key: "banners", segment: "banners", icon: Images },
      { key: "content", segment: "content", icon: FileText },
      // Beside site content rather than under settings: the terms and
      // the privacy policy are pages a visitor reads, not configuration.
      { key: "policies", segment: "policies", icon: Scale },
      { key: "branding", segment: "branding", icon: Palette },
    ],
  },
  {
    key: "system",
    icon: Puzzle,
    pages: [
      { key: "settings", segment: "settings", icon: Settings },
      { key: "catalogue", segment: "catalogue", icon: Database },
      { key: "outbox", segment: "outbox", icon: BellRing },
    ],
  },
  {
    key: "security",
    icon: ShieldCheck,
    pages: [
      { key: "adminUsers", segment: "admin-users", icon: UsersRound },
      { key: "audit", segment: "audit", icon: ScrollText },
    ],
  },
];

/** Every page in the panel, home first, in sidebar order. */
export const CONTROL_PANEL_PAGES: readonly ControlPanelPage[] = [
  CONTROL_PANEL_HOME,
  ...CONTROL_PANEL_GROUPS.flatMap((group) => group.pages),
];

/**
 * The console's map, in the shape every portal's chrome reads.
 *
 * The GROUPS and SEGMENTS above are unchanged; this only names them as
 * one map so the shared sidebar can be handed the console's
 * destinations the same way the buyer's and the supplier's layouts hand
 * it theirs. Nothing here can reach another portal: a map only ever
 * names segments under its own root.
 */
export const CONTROL_PANEL_MAP: PortalNavMap = {
  root: "admin",
  home: CONTROL_PANEL_HOME,
  groups: CONTROL_PANEL_GROUPS,
};

/**
 * Which page a pathname is on, and which group holds it.
 *
 * Delegated to the shared locator: matches the LONGEST segment, treats
 * a detail screen as belonging to the section it was opened from, and
 * matches the portal root only exactly.
 */
export function locateControlPanelPage(pathname: string): {
  page: ControlPanelPage;
  group: ControlPanelGroup | null;
} | null {
  return locatePortalPage(CONTROL_PANEL_MAP, pathname) as {
    page: ControlPanelPage;
    group: ControlPanelGroup | null;
  } | null;
}
