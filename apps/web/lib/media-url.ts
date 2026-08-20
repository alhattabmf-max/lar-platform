import { getBrowserApiBaseUrl } from "./env";

/**
 * Turns an API-relative media route into an absolute URL for the
 * browser.
 *
 * `imageUrl` values from the API are paths on the API origin
 * (`/api/v1/opportunities/:id/image`), and the web app is served from a
 * different origin — so an `<img src>` left relative would resolve
 * against the WEB origin and 404.
 *
 * Always the BROWSER base URL, never the internal one: the tag is
 * resolved by the visitor's browser, which cannot reach a
 * cluster-internal address. This is why `resolveApiBaseUrl()` (which
 * switches on where the code is executing) is deliberately not used —
 * an image URL built during server rendering must still be the public
 * one.
 *
 * A value that is already absolute is returned untouched, and null
 * passes through as null so callers keep their no-image branch.
 */
export function mediaUrl(path: string): string;
export function mediaUrl(path: string | null): string | null;
export function mediaUrl(path: string | null): string | null {
  if (path === null) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${getBrowserApiBaseUrl()}${path}`;
}
