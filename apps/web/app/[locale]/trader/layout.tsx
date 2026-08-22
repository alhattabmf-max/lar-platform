import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadUnreadNotificationCount } from "@/lib/trader-data";
import { AppShell } from "@/components/shell/app-shell";
import { TraderNav } from "@/components/shell/trader-nav";

/**
 * The trader portal layout: full chrome, guarded.
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
 * internal-path allowlist before it could be trusted — so a trader
 * simply lands on their dashboard after signing in. That is a decision,
 * not an oversight.
 *
 * `middleware.ts` stays locale-only: no role logic runs per navigation.
 *
 * There is deliberately NO "Documents" item. Documents are exposed only
 * as `GET /trader/orders/:id/documents` — per order, with no flat
 * paginated list — so a standalone page could only be built by fanning
 * out over the orders list, whose page boundaries would be the ORDERS'.
 * They are shown inside each order instead, and an inert menu item
 * pointing at a page that will not exist for a while is worse than no
 * item at all.
 */
/**
 * Every page under /trader is rendered per request.
 *
 * Declared on the LAYOUT so it is inherited by the whole segment: a
 * page added later cannot forget it, whereas a per-page declaration is
 * exactly the kind of thing that gets omitted once.
 *
 * This is not a performance setting. These pages carry one signed-in
 * company's orders, notifications and bank details, and a statically
 * generated or shared-cache copy of them is a cross-tenant data leak —
 * the build output showed them as prerendered before this line existed.
 *
 * It does NOT disable the data cache; the reads in lib/trader-data.ts
 * set `cache: "no-store"` explicitly for their own reasons.
 */
export const dynamic = "force-dynamic";

export default async function TraderLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.nav" });

  // The unread badge is a nice-to-have on the chrome; a failure here
  // must not stop the portal rendering, so it degrades to no badge.
  const unread = await loadUnreadNotificationCount();
  const unreadCount = unread.ok ? unread.data.unread : undefined;

  const base = `/${appLocale}/trader`;

  return (
    <AppShell locale={appLocale}>
      <TraderNav
        navLabel={t("label")}
        className="-mx-4 -mt-8 mb-6"
        items={[
          { key: "dashboard", label: t("dashboard"), href: base },
          { key: "opportunities", label: t("opportunities"), href: `${base}/opportunities` },
          { key: "orders", label: t("orders"), href: `${base}/orders` },
          {
            key: "notifications",
            label: t("notifications"),
            href: `${base}/notifications`,
            badge: unreadCount,
          },
          { key: "disputes", label: t("disputes"), href: `${base}/disputes` },
          { key: "replacements", label: t("replacements"), href: `${base}/replacements` },
          { key: "account", label: t("account"), href: `${base}/account` },
        ]}
      />
      {children}
    </AppShell>
  );
}
