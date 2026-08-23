import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierUnreadCount } from "@/lib/supplier-data";
import { AppShell } from "@/components/shell/app-shell";
import { SupplierNav, type SupplierNavKey } from "@/components/shell/supplier-nav";

/**
 * The supplier portal layout: full chrome, guarded.
 *
 * Until 8E.3 this segment did not exist at all, while
 * `portalPathFor()` had always sent a signed-in supplier to
 * `/{locale}/supplier` — so the one thing the product did with a
 * supplier account was redirect it to a 404. That is what this closes.
 *
 * `requireRoleOrRedirect` runs on the SERVER before any child renders.
 * It throws Next's redirect signal, so an unauthenticated or
 * wrong-role visitor never receives the page body — it is not rendered
 * and then hidden. Unauthenticated goes to login (they can fix that);
 * the wrong role goes to `/unauthorized`, because signing in again
 * with the same account would change nothing.
 *
 * No `returnTo` is passed. A Server Component layout cannot read the
 * pathname, and a value taken from the query string would need an
 * internal-path allowlist before it could be trusted — so a supplier
 * simply lands on their dashboard after signing in. That is a
 * decision, not an oversight.
 *
 * `middleware.ts` stays locale-only: no role logic runs per navigation.
 */
/**
 * Every page under /supplier is rendered per request.
 *
 * Declared on the LAYOUT so it is inherited by the whole segment: a
 * page added later cannot forget it, whereas a per-page declaration is
 * exactly the kind of thing that gets omitted once.
 *
 * This is not a performance setting. These pages carry one signed-in
 * company's orders, payouts and bank details, and a statically
 * generated or shared-cache copy of them is a cross-tenant data leak.
 *
 * It does NOT disable the data cache; the reads in lib/supplier-data.ts
 * set `cache: "no-store"` explicitly for their own reasons.
 */
export const dynamic = "force-dynamic";

export default async function SupplierLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.nav" });

  // The unread badge is a nice-to-have on the chrome; a failure here
  // must not stop the portal rendering, so it degrades to no badge.
  const unread = await loadSupplierUnreadCount();
  const unreadCount = unread.ok ? unread.data.unread : undefined;

  const labels = {
    dashboard: t("dashboard"),
    orders: t("orders"),
    opportunities: t("opportunities"),
    products: t("products"),
    settlements: t("settlements"),
    disputes: t("disputes"),
    replacements: t("replacements"),
    notifications: t("notifications"),
    account: t("account"),
  } satisfies Record<SupplierNavKey, string>;

  return (
    <AppShell locale={appLocale}>
      <SupplierNav
        locale={appLocale}
        navLabel={t("label")}
        labels={labels}
        comingSoonLabel={t("comingSoon")}
        unreadCount={unreadCount}
        className="-mx-4 -mt-8 mb-6"
      />
      {children}
    </AppShell>
  );
}
