import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { getAdminSession } from "@/lib/admin-session";
import { ControlPanelShell } from "@/components/admin/control-panel-shell";
import { AdminLoginGate } from "@/components/admin/admin-login-gate";

/**
 * THE TAB'S NAME, which every admin page was leaving blank.
 *
 * Declared as a TEMPLATE on the layout so a page only has to say its
 * own name: `«المنشآت»` becomes `«المنشآت | لوحة التحكم»`. A page that
 * forgets still gets the `default`, so the worst case is the portal's
 * name rather than an empty tab.
 *
 * The portal's name is the one the sidebar already shows, read from
 * the same key — so the tab and the screen cannot drift apart.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const nav = await getTranslations({
    locale: locale as AppLocale,
    namespace: "admin.nav",
  });
  const portal = nav("portalName");

  return { title: { template: `%s | ${portal}`, default: portal } };
}

/**
 * The admin portal layout.
 *
 * Every page under /admin is rendered per request. Declared on the
 * LAYOUT so the whole segment inherits it: a page added later cannot
 * forget it, whereas a per-page declaration is exactly the kind of
 * thing that gets omitted once.
 *
 * This is not a performance setting. These pages carry every company's
 * records, every payout and every audit entry, and a statically
 * generated or shared-cache copy of them is a disclosure of the entire
 * platform. It does NOT disable the data cache; the reads in
 * lib/admin-data.ts set `cache: "no-store"` explicitly for their own
 * reasons.
 */
export const dynamic = "force-dynamic";

/**
 * The guard runs HERE, once, for the whole segment.
 *
 * `getAdminSession()` calls `GET /admin/auth/me`, which re-reads the
 * admin row rather than trusting the session blob — so an account
 * disabled mid-session stops rendering this portal on its next
 * navigation.
 *
 * The unauthenticated branch renders the LOGIN SCREEN in place rather
 * than redirecting. Nesting the login page inside a segment whose own
 * layout requires a session would be a redirect loop, and hoisting it
 * out to its own route group would put the one screen an administrator
 * reaches while signed out at a different path from the portal it
 * belongs to. Rendering it here means the address never changes, the
 * portal chrome never appears without a session behind it, and there is
 * no `/unauthorized` branch: anyone who is not an administrator has no
 * business learning whether an admin area exists, so both "not signed
 * in" and "not an administrator" produce the same screen.
 *
 * React's `cache()` inside `getAdminSession` deduplicates this call
 * with the one each page makes, within a single request.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  const session = await getAdminSession();
  if (!session) return <AdminLoginGate locale={appLocale} />;

  return (
    <ControlPanelShell locale={appLocale} session={session}>
      {children}
    </ControlPanelShell>
  );
}
