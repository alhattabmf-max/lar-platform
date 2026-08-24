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
 * so every product, opportunity and banner image is broken.
 *
 * Why `same-site` and not `cross-origin`
 * --------------------------------------
 * `cross-origin` would let ANY site embed these images. `same-site` lets
 * only this deployment's own sites do it, which is all that is needed:
 * CORP compares SITE (scheme + registrable domain), ignoring the port,
 * so `localhost:3001` -> `localhost:3000` and
 * `app.forsa.sa` -> `api.forsa.sa` both pass, while `evil.com` does not.
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
];

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
    res.setHeader("Cross-Origin-Resource-Policy", EMBEDDABLE_IMAGE_CORP);
  }
  next();
}
