import type { MeResponse } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";

/**
 * Where each surface lives — as plain string building, nothing more.
 *
 * WHY IT IS ITS OWN MODULE. `lib/auth-redirects.ts` performs the
 * navigations, and to decide them it reads the session through
 * `next/headers` — server-only code that a Client Component cannot
 * import. The login form needs the same answer ("where does this
 * session belong?") on the client, and the one thing worse than
 * importing a server module into the browser is writing the rule a
 * second time so the two can quietly disagree. So the RULE lives here,
 * where both sides can read it, and the redirecting stays there.
 */

export type PortalRole = "TRADER" | "SUPPLIER";

export function loginPath(locale: AppLocale, returnTo?: string): string {
  const base = `/${locale}/login`;
  if (!returnTo) return base;
  // Only ever an internal path. An absolute URL here would make the
  // login page an open redirect.
  const safe =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `${base}?returnTo=${encodeURIComponent(safe)}`;
}

export function unauthorizedPath(locale: AppLocale): string {
  return `/${locale}/unauthorized`;
}

export function portalPathFor(locale: AppLocale, role: PortalRole): string {
  return role === "TRADER" ? `/${locale}/trader` : `/${locale}/supplier`;
}

/**
 * Where a signed-in company belongs: its own portal, always.
 *
 * THERE IS NO WAITING ROOM. A company whose record is incomplete used
 * to be sent to a page of its own before it could reach anything —
 * which meant the one screen it was allowed to see was a form. An
 * incomplete record now closes the commercial work that genuinely
 * needs the data and NOTHING ELSE: the dashboard opens, says what is
 * missing, and links to the section that fixes it.
 *
 * The kind of account decides WHICH portal, exactly as it decides the
 * permissions: a supplier never lands on the buyer's dashboard.
 */
export function landingPathFor(locale: AppLocale, session: MeResponse): string {
  return portalPathFor(locale, session.company.accountType as PortalRole);
}
