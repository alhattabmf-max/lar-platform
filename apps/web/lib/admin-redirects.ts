import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getAdminSession, type AdminSession } from "./admin-session";

/**
 * Turns "is this an administrator?" into a real navigation.
 *
 * Deliberately separate from `requireRoleOrRedirect`, which compares
 * `company.accountType` against TRADER or SUPPLIER. An administrator has
 * no company and no `accountType`, so extending that union would have
 * meant a role the company-session path can never satisfy — a guard that
 * always redirects, which is worse than no guard because it looks like
 * one.
 *
 * Runs on the SERVER. `redirect()` throws Next's control-flow signal, so
 * nothing after this call runs for a visitor who fails the check: the
 * page body is never produced rather than produced and hidden.
 */

export function adminLoginPath(locale: AppLocale): string {
  return `/${locale}/admin/login`;
}

/**
 * Requires a signed-in, ACTIVE administrator.
 *
 * There is only ONE outcome for failure — the admin login page — and no
 * `/unauthorized` branch. The company portals distinguish "not signed
 * in" from "signed in as the wrong role" because both are reachable
 * states for a real person. Here, anyone who is not an administrator has
 * no business knowing whether an admin area exists at all, so both
 * answers are the same page.
 *
 * No `returnTo`. A Server Component cannot read the pathname, and a
 * value taken from the query string would need an internal-path
 * allowlist before it could be trusted — an admin lands on the dashboard
 * after signing in. That is a decision, not an oversight.
 */
export async function requireAdminOrRedirect(locale: AppLocale): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect(adminLoginPath(locale));
  return session;
}

/**
 * For the admin login page: sends an already-signed-in administrator to
 * the dashboard instead of showing them a login form.
 */
export async function redirectIfAdminAuthenticated(locale: AppLocale): Promise<void> {
  const session = await getAdminSession();
  if (session) redirect(`/${locale}/admin`);
}
