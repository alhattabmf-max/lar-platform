import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import {
  EMBEDDABLE_IMAGE_CORP,
  embeddableImageCorp,
  embeddableImageCorpMiddleware,
  isEmbeddableImagePath,
} from "./embeddable-image-corp";

/**
 * Proves the header a browser actually receives, by running the REAL
 * `helmet()` and then the real override in the same order `configureApp`
 * mounts them. Nothing is stubbed: if helmet's default ever changes, or
 * the override stops matching a route, these fail.
 */

/** A minimal Express-shaped response that records what was set. */
function fakeResponse() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    getHeader(name: string) {
      return headers[name];
    },
    removeHeader(name: string) {
      delete headers[name];
    },
  };
}

/** helmet, then the override — exactly the order in configureApp. */
function corpFor(path: string): string | undefined {
  const req = { path, method: "GET", headers: {} } as unknown as Request;
  const res = fakeResponse();
  const next: NextFunction = () => undefined;

  helmet()(req, res as unknown as Response, next);
  embeddableImageCorpMiddleware(req, res as unknown as Response, next);

  return res.headers["Cross-Origin-Resource-Policy"];
}

const IMAGE_ROUTES = [
  "/api/v1/opportunities/1b0dc1b1-5b21-4091-b936-a7f22b937742/image",
  "/api/v1/banners/9f1c2e40-0000-4000-8000-000000000001/image",
  "/api/v1/admin/banners/9f1c2e40-0000-4000-8000-000000000002/image",
  "/api/v1/companies/me/products/1d500d70-06ea-484e-8df5-212cf54729c5/media/a4d13d48-d2bb-4cee-b55c-2c5eb8300ec3/image",
  // The header logo. Left out when it shipped, which is why it rendered
  // as a broken image on every page while the API answered 200 — a
  // browser discards a subresource it fetched successfully when CORP
  // says same-origin.
  "/api/v1/branding/logo",
  "/api/v1/admin/branding/logo/image",
];

const NON_IMAGE_ROUTES = [
  "/api/v1/opportunities/active",
  "/api/v1/opportunities/1b0dc1b1-5b21-4091-b936-a7f22b937742",
  "/api/v1/companies/me/products",
  "/api/v1/companies/me/policy-limits",
  "/api/v1/trader/orders",
  "/api/v1/admin/banners",
  "/api/v1/admin/audit-logs",
  "/api/v1/auth/login",
  "/api/v1/policies/active",
  "/api/v1/public/site-content",
  // The JSON neighbours of the two logo routes. Both are one segment
  // away from an entry in the list, and both return a JSON body that no
  // page embeds — so neither may be relaxed by a pattern meant for the
  // image beside it.
  "/api/v1/branding",
  "/api/v1/admin/branding",
  "/api/v1/admin/branding/logo",
];

describe("Cross-Origin-Resource-Policy", () => {
  it("helmet's own default is same-origin — the premise of this whole file", () => {
    const res = fakeResponse();
    helmet()({ headers: {}, method: "GET" } as unknown as Request, res as unknown as Response, () => undefined);
    expect(res.headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });

  describe("every image route is embeddable by a first-party page", () => {
    it.each(IMAGE_ROUTES)("%s", (path) => {
      // NOT `same-origin`, which is helmet's default and what breaks
      // every image: the web app is served from a DIFFERENT ORIGIN on
      // purpose.
      expect(corpFor(path)).not.toBe("same-origin");
    });

    it("a thumbnail variant matches too — req.path excludes the query string", () => {
      // Express strips `?variant=thumb` before `req.path`, so the same
      // route with a variant is the same path.
      expect(corpFor("/api/v1/opportunities/abc/image")).not.toBe(
        "same-origin",
      );
    });
  });

  describe("which value, and why it depends on the environment", () => {
    it("keeps the stricter header where the hosts are real domains", () => {
      // `app.forsa.sa` -> `api.forsa.sa` is same-site, so production
      // needs nothing looser.
      expect(embeddableImageCorp("production")).toBe("same-site");
      expect(EMBEDDABLE_IMAGE_CORP).toBe("same-site");
    });

    it("relaxes it everywhere else, because a dev host may be an IP", () => {
      // AN IP ADDRESS HAS NO REGISTRABLE DOMAIN for CORP to compare,
      // so `http://172.20.10.4:3001` embedding
      // `http://172.20.10.4:3000/.../image` is refused with
      // `net::ERR_BLOCKED_BY_RESPONSE.NotSameSite` — measured, on the
      // logo, the banner and every product thumbnail at once, while
      // the API answered 200 to all of them.
      for (const env of ["development", "test", undefined]) {
        expect(embeddableImageCorp(env)).toBe("cross-origin");
      }
    });

    it("still says nothing about who may READ a private route", () => {
      // CORP is not an access control and never was: the session
      // guard is. A cross-site `<img>` carries no `lax` cookie, so a
      // stranger's page gets 401 rather than a picture — which is why
      // relaxing this header on a developer's machine costs nothing.
      const guarded = NON_IMAGE_ROUTES[0];
      expect(corpFor(guarded)).toBe("same-origin");
    });
  });

  describe("every JSON route keeps same-origin", () => {
    it.each(NON_IMAGE_ROUTES)("%s", (path) => {
      expect(corpFor(path)).toBe("same-origin");
    });
  });

  describe("the allowlist cannot be widened by a crafted path", () => {
    it.each([
      // A traversal-shaped id must not turn one route into another.
      "/api/v1/opportunities/a/b/image",
      "/api/v1/companies/me/products/a/media/image",
      // Neighbouring routes that merely start or end alike.
      "/api/v1/opportunities/abc/image/raw",
      "/api/v1/opportunities/abc/images",
      "/api/v1/banners",
      "/api/v1/admin/banners/abc",
      // Not under the API prefix at all.
      "/opportunities/abc/image",
      "/ready",
    ])("%s is not treated as an embeddable image", (path) => {
      expect(isEmbeddableImagePath(path)).toBe(false);
      expect(corpFor(path)).toBe("same-origin");
    });
  });

  it("covers exactly the routes that serve an image, and no more", () => {
    // A fifth image route added later must be added here deliberately,
    // rather than silently inheriting the strict default and rendering
    // as a broken image.
    expect(IMAGE_ROUTES.filter(isEmbeddableImagePath)).toHaveLength(6);
    expect(NON_IMAGE_ROUTES.filter(isEmbeddableImagePath)).toHaveLength(0);
  });
});
