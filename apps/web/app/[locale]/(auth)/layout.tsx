import type { ReactNode } from "react";
import { MinimalShell } from "@/components/shell/minimal-shell";
import { redirectIfAuthenticated } from "@/lib/auth-redirects";
import type { AppLocale } from "@/i18n/routing";

/**
 * The (auth) group: minimal chrome, and a guard in the OTHER direction.
 *
 * An already-signed-in visitor is redirected to their portal rather
 * than shown a login form — reaching /login with a live session almost
 * always means a stale bookmark or a back-button, and re-presenting the
 * form invites a pointless second authentication.
 *
 * The check runs on the server, before any markup is produced. It reads
 * `GET /me`, never a client-held role.
 */
export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  await redirectIfAuthenticated(appLocale);

  return <MinimalShell locale={appLocale}>{children}</MinimalShell>;
}
