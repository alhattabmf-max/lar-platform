import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import {
  ForbiddenRoleError,
  UnauthenticatedError,
  getSession,
  type PortalRole,
} from "./session";
import { landingPathFor, loginPath, unauthorizedPath } from "./portal-paths";

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

export {
  loginPath,
  unauthorizedPath,
  portalPathFor,
  landingPathFor,
} from "./portal-paths";

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
  returnTo?: string,
) {
  const session = await getSession();
  if (!session) redirect(loginPath(locale, returnTo));

  if (session.company.accountType !== role) {
    redirect(unauthorizedPath(locale));
  }

  // AN INCOMPLETE RECORD BLOCKS NOTHING HERE. Signing in, reaching the
  // dashboard, changing language and signing out are never withheld
  // because a branch or a bank account is missing — the portal says
  // what is missing and links to it. What an incomplete record closes
  // is the commercial work that genuinely cannot be done without the
  // data, and that is enforced where the work happens.

  return session;
}

/**
 * For the (auth) group: sends an already-signed-in visitor where they
 * belong instead of showing them a login form.
 */
export async function redirectIfAuthenticated(locale: AppLocale) {
  const session = await getSession();
  if (session) {
    redirect(landingPathFor(locale, session));
  }
}

export { ForbiddenRoleError, UnauthenticatedError };
