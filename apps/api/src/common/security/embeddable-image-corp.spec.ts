import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import {
  EMBEDDABLE_IMAGE_CORP,
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
];

describe("Cross-Origin-Resource-Policy", () => {
  it("helmet's own default is same-origin — the premise of this whole file", () => {
    const res = fakeResponse();
    helmet()({ headers: {}, method: "GET" } as unknown as Request, res as unknown as Response, () => undefined);
    expect(res.headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });

  describe("the four image routes are same-site", () => {
    it.each(IMAGE_ROUTES)("%s", (path) => {
      expect(corpFor(path)).toBe("same-site");
      expect(EMBEDDABLE_IMAGE_CORP).toBe("same-site");
    });

    it("a thumbnail variant matches too — req.path excludes the query string", () => {
      // Express strips `?variant=thumb` before `req.path`, so the same
      // route with a variant is the same path.
      expect(corpFor("/api/v1/opportunities/abc/image")).toBe("same-site");
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
    expect(IMAGE_ROUTES.filter(isEmbeddableImagePath)).toHaveLength(4);
    expect(NON_IMAGE_ROUTES.filter(isEmbeddableImagePath)).toHaveLength(0);
  });
});
