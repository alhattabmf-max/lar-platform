import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { ForbiddenRoleError, UnauthenticatedError, getSession, type PortalRole } from "./session";

/**
 * Turns the session helpers' thrown outcomes into real navigations.
 *
 * The split is deliberate: `lib/session.ts` decides WHETHER access is
 * allowed and knows nothing about routing, while this module decides
 * WHERE a refusal goes. That keeps the access decision unit-testable
 * without Next's navigation, and keeps route knowledge out of the
 * security boundary.
 *
 * Every guard here runs on the SERVER. Nothing about access control is
 * decided in the browser: a client-side check would be advisory at
 * best, since the page payload would already have been produced.
 */

export function loginPath(locale: AppLocale, returnTo?: string): string {
  const base = `/${locale}/login`;
  if (!returnTo) return base;
  // Only ever an internal path. An absolute URL here would make the
  // login page an open redirect.
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `${base}?returnTo=${encodeURIComponent(safe)}`;
}

export function unauthorizedPath(locale: AppLocale): string {
  return `/${locale}/unauthorized`;
}

export function portalPathFor(locale: AppLocale, role: PortalRole): string {
  return role === "TRADER" ? `/${locale}/trader` : `/${locale}/supplier`;
}

/**
 * Requires ANY authenticated session. Redirects to login when absent.
 *
 * `redirect()` throws a Next control-flow signal, so nothing after this
 * call runs for an unauthenticated visitor — the page body is never
 * rendered, not merely hidden.
 */
export async function requireSession(locale: AppLocale, returnTo?: string) {
  const session = await getSession();
  if (!session) redirect(loginPath(locale, returnTo));
  return session;
}

/**
 * Requires a session belonging to `role`.
 *
 * Unauthenticated goes to login (the visitor can fix that). Wrong role
 * goes to the shared 403 page — redirecting them to login instead would
 * be misleading, since signing in again with the same account changes
 * nothing.
 */
export async function requireRoleOrRedirect(
  locale: AppLocale,
  role: PortalRole,
  returnTo?: string
) {
  const session = await getSession();
  if (!session) redirect(loginPath(locale, returnTo));

  if (session.company.accountType !== role) {
    redirect(unauthorizedPath(locale));
  }

  return session;
}

/**
 * For the (auth) group: sends an already-signed-in visitor to their own
 * portal instead of showing them a login form.
 */
export async function redirectIfAuthenticated(locale: AppLocale) {
  const session = await getSession();
  if (session) {
    redirect(portalPathFor(locale, session.company.accountType as PortalRole));
  }
}

export { ForbiddenRoleError, UnauthenticatedError };
