import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AdminSession } from "@/lib/admin-session";
import type { AppLocale } from "@/i18n/routing";
import { SkipLink } from "@/components/ui/skip-link";
import { PortalNav } from "@/components/shell/portal-nav";
import { AdminSignOut } from "./admin-sign-out";

/**
 * The admin portal's frame.
 *
 * ITS OWN SHELL, not `AppShell`. That one fetches public branding and
 * renders the marketplace header and footer — an administrator's
 * operational console is not a storefront, and dressing it as one would
 * mean an outage in the branding read could take down the screen used to
 * fix outages. It also means the admin console does not change
 * appearance when an operator edits the site's colours.
 *
 * Landmark structure matches the rest of the app: skip link → header →
 * `<main id="main-content" tabIndex={-1}>` → footer. `tabIndex={-1}` is
 * what makes focus actually land on `main` when the skip link is used;
 * without it the browser scrolls and leaves focus behind.
 *
 * The nav renderer is shared with the company portals — one
 * implementation of coming-soon handling, badges and wrapping — while
 * the destination list lives here, where "which admin screens exist" is
 * one testable decision.
 */
export type AdminNavKey =
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
  | "catalogue"
  | "banners"
  | "branding"
  | "content"
  | "settings"
  | "adminUsers"
  | "audit"
  | "outbox";

export interface AdminNavDestination {
  key: AdminNavKey;
  /** Path under the portal root, or "" for the dashboard itself. */
  segment: string;
}

/**
 * Every admin destination, in the order an operator scans them.
 *
 * Grouped by what they are for rather than alphabetically: the daily
 * queues first, then money, then catalogue and presentation, then the
 * platform's own configuration and records.
 */
export const ADMIN_NAV_DESTINATIONS: readonly AdminNavDestination[] = [
  { key: "dashboard", segment: "" },
  { key: "companies", segment: "companies" },
  { key: "products", segment: "products" },
  { key: "opportunities", segment: "opportunities" },
  { key: "orders", segment: "orders" },
  { key: "disputes", segment: "disputes" },
  { key: "refunds", segment: "refunds" },
  { key: "settlements", segment: "settlements" },
  { key: "bankAccounts", segment: "bank-accounts" },
  { key: "invoicing", segment: "invoicing" },
  { key: "catalogue", segment: "catalogue" },
  { key: "banners", segment: "banners" },
  { key: "branding", segment: "branding" },
  { key: "content", segment: "content" },
  { key: "settings", segment: "settings" },
  { key: "adminUsers", segment: "admin-users" },
  { key: "audit", segment: "audit" },
  { key: "outbox", segment: "outbox" },
];

export interface AdminShellProps {
  locale: AppLocale;
  session: AdminSession;
  children: ReactNode;
}

export async function AdminShell({ locale, session, children }: AdminShellProps) {
  const t = await getTranslations({ locale, namespace: "admin.nav" });
  const common = await getTranslations({ locale, namespace: "common" });
  const shell = await getTranslations({ locale, namespace: "shell" });

  const base = `/${locale}/admin`;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SkipLink label={shell("skipToContent")} />

      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link
            href={base}
            className="inline-flex min-h-11 items-center text-base font-semibold text-content"
          >
            {t("portalName")}
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            {/* The operator's own email, so it is obvious which account
                is acting — an admin console is exactly where "who am I
                signed in as" must never be a guess. */}
            <span className="text-sm text-content-muted">{session.email}</span>
            {!session.twoFactorEnabled ? (
              <span className="rounded-md border border-warning bg-warning-surface px-2 py-0.5 text-xs text-warning-text">
                {t("twoFactorMissing")}
              </span>
            ) : null}
            <AdminSignOut locale={locale} label={t("signOut")} working={common("loading")} />
          </div>
        </div>
      </header>

      <PortalNav
        navLabel={t("label")}
        className="-mt-px"
        items={ADMIN_NAV_DESTINATIONS.map((destination) => ({
          key: destination.key,
          label: t(destination.key),
          href: destination.segment ? `${base}/${destination.segment}` : base,
        }))}
      />

      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-content-muted">
          {t("footerNote")}
        </div>
      </footer>
    </div>
  );
}
