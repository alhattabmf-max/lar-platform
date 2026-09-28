import type { NextFunction, Request, Response } from "express";

/**
 * Relaxes `Cross-Origin-Resource-Policy` to `same-site` for the image
 * routes, and ONLY for them.
 *
 * Why it is needed
 * ----------------
 * `helmet()` defaults every response to
 * `Cross-Origin-Resource-Policy: same-origin`. That is right for every
 * JSON response this API returns, and wrong for the images, because the
 * web app is served from a DIFFERENT ORIGIN on purpose — see
 * `apps/web/lib/media-url.ts`, which exists solely to build absolute
 * URLs onto the API origin. Under `same-origin` a browser refuses to
 * render them:
 *
 *     GET /api/v1/opportunities/:id/image
 *       -> net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
 *
 * so every product, opportunity, banner and brand-logo image is
 * broken.
 *
 * Why `same-site` in production
 * -----------------------------
 * `cross-origin` would let ANY site embed these images. `same-site` lets
 * only this deployment's own sites do it, which is all that is needed:
 * CORP compares SITE (scheme + registrable domain), ignoring the port,
 * so `app.forsa.sa` -> `api.forsa.sa` passes while `evil.com` does not.
 *
 * Why NOT `same-site` outside production
 * --------------------------------------
 * BECAUSE A DEVELOPMENT HOST IS OFTEN AN IP ADDRESS, and an IP
 * address has no registrable domain for that comparison to be made
 * against. Reading the platform from a phone means serving it on
 * the machine's LAN address, and Chrome then answers every image
 * with:
 *
 *     net::ERR_BLOCKED_BY_RESPONSE.NotSameSite
 *
 * — measured, on the logo, the banner and every product thumbnail
 * at once: «الصور لا تظهر في سطح المكتب، حتى البنر والشعار وصور
 *  المنتجات». The API answers 200 and the browser drops the bytes,
 * so nothing appears in the network log as a failure.
 *
 * THE RELAXATION IS FENCED BY `NODE_ENV`. A deployment always has
 * real domain names, so it keeps the stricter header; only a
 * developer's own machine, reachable from their own network, hands
 * out `cross-origin`.
 *
 * AND IT IS NOT AN ACCESS CONTROL EITHER WAY — see below.
 *
 * Why this does not weaken authentication
 * ---------------------------------------
 * CORP is not an access control and never was the thing protecting the
 * private routes — the session guard is. Both session cookies are
 * `sameSite: "lax"` (`session-cookie.util.ts`,
 * `admin-session-cookie.util.ts`) and a cross-site `<img>` is a
 * subresource request that carries no cookie, so an attacker's page
 * receives `401`, not an image. The legitimate case keeps working
 * because SameSite is also evaluated per SITE rather than per origin.
 */

/**
 * The exact routes a first-party page may embed. Anchored at both ends,
 * and `[^/]+` cannot traverse a path separator, so no segment here can
 * be widened into a different route by a crafted id.
 */
export const EMBEDDABLE_IMAGE_ROUTES: readonly RegExp[] = [
  /^\/api\/v1\/opportunities\/[^/]+\/image$/,
  /^\/api\/v1\/banners\/[^/]+\/image$/,
  /^\/api\/v1\/admin\/banners\/[^/]+\/image$/,
  /^\/api\/v1\/companies\/me\/products\/[^/]+\/media\/[^/]+\/image$/,
  // The header logo, added in 8G and missed here — which is why it
  // rendered as a broken image on every page while the API was
  // answering 200. Both are literal paths with no id segment: the
  // language is a query parameter, and `req.path` excludes the query.
  /^\/api\/v1\/branding\/logo$/,
  /^\/api\/v1\/admin\/branding\/logo\/image$/,
];

/**
 * The header value for this environment. Production keeps the
 * stricter one; anything else has to survive an IP-address host.
 */
export function embeddableImageCorp(nodeEnv: string | undefined): string {
  return nodeEnv === "production" ? "same-site" : "cross-origin";
}

/** What a production deployment sends. */
export const EMBEDDABLE_IMAGE_CORP = "same-site";

export function isEmbeddableImagePath(path: string): boolean {
  return EMBEDDABLE_IMAGE_ROUTES.some((route) => route.test(path));
}

/**
 * Mounted immediately AFTER `helmet()`, so it overrides the default it
 * has already set. `req.path` excludes the query string, which is why
 * `?variant=thumb` still matches.
 */
export function embeddableImageCorpMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (isEmbeddableImagePath(req.path)) {
    res.setHeader(
      "Cross-Origin-Resource-Policy",
      embeddableImageCorp(process.env.NODE_ENV),
    );
  }
  next();
}
