/**
 * API base URLs.
 *
 * Two distinct values, because the browser and the Next.js server reach
 * the API over different network paths:
 *
 *   NEXT_PUBLIC_API_BASE_URL  the public origin the BROWSER calls
 *                             (https://api.forsa.sa in production).
 *                             This value is inlined into the client
 *                             bundle and is therefore public by
 *                             definition.
 *
 *   INTERNAL_API_BASE_URL     the origin the Next.js SERVER calls. May be
 *                             an internal address that never leaves the
 *                             cluster. Server-only — never prefixed with
 *                             NEXT_PUBLIC_.
 *
 * NEXT_PUBLIC_* is a public channel: any value placed there ships to
 * every visitor. No secret, token, key, or internal hostname may ever be
 * put behind that prefix (docs/PHASE_8_IMPLEMENTATION_PLAN.md §2).
 */

const DEFAULT_BROWSER_BASE_URL = "http://localhost:3000";

export function getBrowserApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_BROWSER_BASE_URL;
}

export function getServerApiBaseUrl(): string {
  return process.env.INTERNAL_API_BASE_URL ?? getBrowserApiBaseUrl();
}

/** True when running in the browser, false in a Server Component. */
export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function resolveApiBaseUrl(): string {
  return isBrowser() ? getBrowserApiBaseUrl() : getServerApiBaseUrl();
}

/**
 * Path prefix every REST route lives under. `/health` and `/ready` are
 * deliberately NOT under it and are infrastructure-only — the web app
 * never calls them.
 */
export const API_PREFIX = "/api/v1";
