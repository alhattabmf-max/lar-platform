import type { AppLocale } from "@/i18n/routing";
import { PortalNav } from "./portal-nav";

/**
 * Supplier portal navigation.
 *
 * The destination list is DATA, declared once here, because "which
 * screens exist" is the one thing about this nav that is easy to get
 * wrong: a link added before its page is a 404 a reader reaches by
 * following our own menu, and a page added without its link is
 * unreachable. `supplier-shell.test.tsx` walks this list against the
 * filesystem, so neither can happen silently.
 *
 * 8E.3 builds the dashboard and the account section. Everything else
 * is declared and marked unbuilt rather than omitted — a supplier
 * should be able to see the shape of their portal and know what is
 * coming, and an item that explains itself beats a gap in the menu.
 */
export type SupplierNavKey =
  | "dashboard"
  | "orders"
  | "opportunities"
  | "products"
  | "settlements"
  | "disputes"
  | "replacements"
  | "notifications"
  | "account";

export interface SupplierNavDestination {
  key: SupplierNavKey;
  /**
   * Path under the portal root, or "" for the dashboard itself.
   *
   * Not a full href: the locale prefix is added at render time, so a
   * destination cannot be declared with one locale baked into it.
   */
  segment: string;
  /** Whether a page.tsx exists for it yet. Asserted against disk. */
  built: boolean;
  /** Only the notifications item carries the unread badge. */
  badged?: boolean;
}

export const SUPPLIER_NAV_DESTINATIONS: readonly SupplierNavDestination[] = [
  { key: "dashboard", segment: "", built: true },
  { key: "orders", segment: "orders", built: true },
  { key: "opportunities", segment: "opportunities", built: true },
  { key: "products", segment: "products", built: true },
  { key: "settlements", segment: "settlements", built: true },
  { key: "disputes", segment: "disputes", built: true },
  { key: "replacements", segment: "replacement-obligations", built: true },
  { key: "notifications", segment: "notifications", built: true, badged: true },
  { key: "account", segment: "account", built: true },
];

export interface SupplierNavProps {
  locale: AppLocale;
  /** Accessible name for the landmark, already translated. */
  navLabel: string;
  /** Every destination's label, already translated. */
  labels: Record<SupplierNavKey, string>;
  /** Shown beside an unbuilt destination, already translated. */
  comingSoonLabel: string;
  /**
   * Unread notifications. Undefined when the count could not be read —
   * the badge is a nice-to-have on the chrome and its failure must not
   * cost the portal its navigation.
   */
  unreadCount?: number;
  className?: string;
}

export function SupplierNav({
  locale,
  navLabel,
  labels,
  comingSoonLabel,
  unreadCount,
  className,
}: SupplierNavProps) {
  const base = `/${locale}/supplier`;

  return (
    <PortalNav
      navLabel={navLabel}
      className={className}
      items={SUPPLIER_NAV_DESTINATIONS.map((destination) => ({
        key: destination.key,
        label: labels[destination.key],
        href: destination.built
          ? destination.segment
            ? `${base}/${destination.segment}`
            : base
          : null,
        ...(destination.built ? {} : { comingSoonLabel }),
        // The badge survives the item being unbuilt on purpose: knowing
        // something is waiting matters most while the screen for it is
        // still being built.
        ...(destination.badged && unreadCount !== undefined ? { badge: unreadCount } : {}),
      }))}
    />
  );
}
