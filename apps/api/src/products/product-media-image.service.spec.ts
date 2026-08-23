/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_MEDIA_VIEW_KEYS, productMediaImagePath } from "@platform/types";
import { ProductMediaImageService } from "./product-media-image.service";
import { etagForObjectKey } from "../opportunities/opportunity-image.service";
import { ImageDeliveryService } from "../common/media/image-delivery.service";

/**
 * A supplier's own product image.
 *
 * Private, unlike the opportunity route: a product may be a DRAFT that has
 * never been published, so its media is not public in any sense.
 *
 * The property these tests exist for: the URL is an ADDRESS, not a capability.
 * Both ids in the path are UUIDs a stale link or a former employee might
 * carry, so possession must grant nothing — every request re-runs the same
 * three-way ownership check in its own query.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY = "99999999-9999-4999-8999-999999999999";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const MEDIA = "33333333-3333-4333-8333-333333333333";

const MAIN_KEY = "products/p1/main.jpg";
const THUMB_KEY = "products/p1/main-thumb.jpg";

function build(row: unknown) {
  const findFirst = jest.fn(async (..._args: any[]) => row);
  const service = new ProductMediaImageService({ productMedia: { findFirst } } as any);
  return { service, findFirst };
}

const mediaRow = (overrides: Record<string, unknown> = {}) => ({
  objectKey: MAIN_KEY,
  thumbnailObjectKey: THUMB_KEY,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  ...overrides,
});

describe("the variant selects a different stored object", () => {
  it("serves the main key for main", async () => {
    const { service } = build(mediaRow());

    const target = await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main");

    expect(target?.objectKey).toBe(MAIN_KEY);
    expect(target?.contentType).toBe("image/jpeg");
  });

  it("serves the thumbnail key for thumb", async () => {
    const { service } = build(mediaRow());

    const target = await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "thumb");

    expect(target?.objectKey).toBe(THUMB_KEY);
  });

  it("gives the two variants DIFFERENT ETags", async () => {
    // A shared validator would let a cached thumbnail satisfy a request for
    // the full image — the browser would believe it already had it.
    const { service } = build(mediaRow());

    const main = await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main");
    const thumb = await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "thumb");

    expect(main?.etag).not.toBe(thumb?.etag);
    expect(main?.etag).toBe(etagForObjectKey(MAIN_KEY));
    expect(thumb?.etag).toBe(etagForObjectKey(THUMB_KEY));
  });

  it("returns a WEAK validator, because it identifies a version not bytes", async () => {
    const { service } = build(mediaRow());
    expect((await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main"))?.weakETag).toBe(true);
  });

  it("uses the media row's own timestamp as Last-Modified", async () => {
    // Media rows are immutable once written — a replacement is a new row — so
    // the image cannot change after this.
    const { service } = build(mediaRow());
    expect((await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main"))?.lastModified).toEqual(
      new Date("2026-08-01T00:00:00.000Z")
    );
  });
});

describe("ownership is re-checked in the query on every request", () => {
  it("filters on media id, product id AND the session's company together", async () => {
    // All three in ONE query. Fetching the media and comparing the company
    // afterwards is one early return away from serving someone else's image.
    const { service, findFirst } = build(mediaRow());

    await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main");

    expect((findFirst.mock.calls[0][0] as any).where).toEqual({
      id: MEDIA,
      productId: PRODUCT,
      product: { companyId: COMPANY },
    });
  });

  it("selects no storage key beyond the two it must resolve", async () => {
    const { service, findFirst } = build(mediaRow());

    await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main");

    expect(Object.keys((findFirst.mock.calls[0][0] as any).select).sort()).toEqual([
      "createdAt",
      "objectKey",
      "thumbnailObjectKey",
    ]);
  });

  it("treats a URL as an address, never as proof", async () => {
    // The path is guessable. Another company asking for a real media id gets
    // the same nothing as someone asking for a fictional one.
    const { service } = build(null);
    expect(await service.findOwnedTarget(OTHER_COMPANY, PRODUCT, MEDIA, "main")).toBeNull();
  });
});

describe("every unservable case answers the same way", () => {
  it.each([
    ["unknown media id", null],
    ["media on a different product", null],
    ["product owned by another company", null],
  ])("%s resolves to null", async (_case, row) => {
    const { service } = build(row);
    expect(await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main")).toBeNull();
  });

  it("returns null for a key nothing can be served as", async () => {
    // A 404 rather than a 500: an unservable extension is a data problem, and
    // a caller must not be able to tell it apart from a missing row.
    const { service } = build(mediaRow({ objectKey: "products/p1/main.exe" }));
    expect(await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main")).toBeNull();
  });

  it("returns null for a key with no extension at all", async () => {
    const { service } = build(mediaRow({ objectKey: "products/p1/main" }));
    expect(await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main")).toBeNull();
  });
});

describe("the delivery path carries ids and a variant, nothing else", () => {
  it("builds from the route's own ids", () => {
    expect(productMediaImagePath(PRODUCT, MEDIA)).toBe(
      `/api/v1/companies/me/products/${PRODUCT}/media/${MEDIA}/image`
    );
    expect(productMediaImagePath(PRODUCT, MEDIA, "thumb")).toBe(
      `/api/v1/companies/me/products/${PRODUCT}/media/${MEDIA}/image?variant=thumb`
    );
  });

  it("contains no storage key, signature or expiry", () => {
    // Not presigned, deliberately: a presigned URL IS a capability — it works
    // for whoever holds it, with no session, until it expires.
    const path = productMediaImagePath(PRODUCT, MEDIA, "thumb");

    for (const forbidden of ["X-Amz", "signature", "expires", "token", "bucket"]) {
      expect([forbidden, path.toLowerCase().includes(forbidden.toLowerCase())]).toEqual([
        forbidden,
        false,
      ]);
    }

    // No file extension anywhere: a storage key ends in one, a route does not.
    // `products/` appears as a ROUTE segment, which is why the check is on
    // the extension rather than on the word.
    expect(path).not.toMatch(/\.(jpe?g|png|webp|gif)/i);

    // Every path segment is either a literal from the route or one of the two
    // ids. Nothing else can have entered.
    const [pathname] = path.split("?");
    const segments = pathname.split("/").filter(Boolean);
    expect(segments).toEqual([
      "api",
      "v1",
      "companies",
      "me",
      "products",
      PRODUCT,
      "media",
      MEDIA,
      "image",
    ]);
  });

  it("puts no URL field where a storage key could be mistaken for one", () => {
    expect([...PRODUCT_MEDIA_VIEW_KEYS]).toEqual([
      "id",
      "url",
      "thumbnailUrl",
      "contentType",
      "sizeBytes",
      "isMain",
      "sortOrder",
    ]);
    expect(PRODUCT_MEDIA_VIEW_KEYS).not.toContain("objectKey");
    expect(PRODUCT_MEDIA_VIEW_KEYS).not.toContain("thumbnailObjectKey");
  });
});

describe("the route's shape, read from its source", () => {
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const CONTROLLER = strip(
    readFileSync(join(__dirname, "product-media-image.controller.ts"), "utf8")
  );
  const SERVICE = strip(readFileSync(join(__dirname, "product-media-image.service.ts"), "utf8"));

  it("is guarded by the session AND the supplier role", () => {
    expect(CONTROLLER).toContain("@UseGuards(SessionAuthGuard, RequireSupplierGuard)");
  });

  it("adds no CsrfGuard, because every route here is a GET", () => {
    expect(CONTROLLER).not.toContain("CsrfGuard");
    const methods = CONTROLLER.match(/@(Get|Post|Put|Patch|Delete)\(/g) ?? [];
    expect(methods).toEqual(["@Get("]);
  });

  it("sits under the supplier's own products path", () => {
    expect(CONTROLLER).toContain('@Controller("companies/me/products/:productId/media")');
    expect(CONTROLLER).toContain('@Get(":mediaId/image")');
  });

  it("reuses the SHARED variant DTO, so an unknown variant is a 400 here too", () => {
    // Two copies of the rule would be free to drift, and a route that
    // accepted a value another rejected is exactly the divergence that shows
    // up months later.
    expect(CONTROLLER).toContain("ImageVariantQueryDto");
    expect(CONTROLLER).toContain("wantsThumbnail(query)");
  });

  it("reuses the SHARED delivery service, so caching cannot drift", () => {
    expect(CONTROLLER).toContain("this.delivery.serve(target,");
    expect(CONTROLLER).toContain("ifNoneMatch");
    expect(CONTROLLER).toContain("ifModifiedSince");
  });

  it("sends no body on a 304", () => {
    expect(CONTROLLER).toContain("if (result.body) res.send(result.body);");
    expect(CONTROLLER).toContain("else res.end();");
  });

  it("takes the company from the SESSION, never from the request", () => {
    // A company id in a path or a query would let a caller name whose image
    // they wanted.
    expect(CONTROLLER).toContain("@CurrentSession() session: SessionData");
    expect(CONTROLLER).toContain("session.companyId,");
    expect(CONTROLLER).not.toMatch(/@Param\("companyId"\)/);
    expect(CONTROLLER).not.toMatch(/@Query\(\)[^)]*companyId/);
  });

  it("puts no object key in a response or a log", () => {
    for (const source of [CONTROLLER, SERVICE]) {
      expect(source).not.toMatch(/res\.set\([^)]*objectKey/);
      expect(source).not.toContain("console.");
      expect(source).not.toMatch(/logger\.[a-z]+\([^)]*objectKey/);
    }
    // The ETag is a HASH of the key, which is what lets a validator be
    // returned without disclosing the address it validates.
    expect(SERVICE).toContain("etagForObjectKey(objectKey)");
  });

  it("issues no presigned URL and grants no public access", () => {
    for (const source of [CONTROLLER, SERVICE]) {
      expect(source).not.toMatch(/presign|getSignedUrl|publicUrl/i);
    }
  });
});

describe("the weak validator survives a round trip to 304", () => {
  /**
   * `weakETag: true` is not cosmetic.
   *
   * The tag is a SHA-256 of the immutable object key, not a hash of the
   * bytes — so it identifies a stored VERSION, not the exact octets. RFC 9110
   * calls that a weak validator and requires the `W/` prefix; claiming strong
   * equivalence for something that never read the file would be a lie the
   * caching layer is entitled to act on.
   *
   * The round trip below is the assertion that matters: whatever the server
   * put in `ETag`, handed straight back as `If-None-Match`, must produce a 304
   * with no body AND no object read. A validator that does not round-trip is
   * worse than none — every request re-downloads while appearing cached.
   */
  function deliveryWithStorage() {
    const read = jest.fn(async (..._args: any[]) => Buffer.from("image-bytes"));
    const delivery = new ImageDeliveryService({ read } as any);
    return { delivery, read };
  }

  it("marks BOTH variants weak", async () => {
    const { service } = build(mediaRow());

    const main = await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main");
    const thumb = await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "thumb");

    expect(main?.weakETag).toBe(true);
    expect(thumb?.weakETag).toBe(true);
  });

  it("emits W/\"…\" on the wire for both, and they differ", async () => {
    const { service } = build(mediaRow());
    const { delivery } = deliveryWithStorage();

    const main = await delivery.serve(
      (await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main"))!
    );
    const thumb = await delivery.serve(
      (await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "thumb"))!
    );

    expect(main.headers.ETag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    expect(thumb.headers.ETag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    // Different stored objects, different validators — otherwise a cached
    // thumbnail would satisfy a request for the full image.
    expect(main.headers.ETag).not.toBe(thumb.headers.ETag);
  });

  it("returns 304 with NO body and NO object read when the tag is handed back", async () => {
    const { service } = build(mediaRow());
    const { delivery, read } = deliveryWithStorage();
    const target = (await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main"))!;

    const first = await delivery.serve(target);
    expect(first.status).toBe(200);
    expect(read).toHaveBeenCalledTimes(1);

    const second = await delivery.serve(target, { ifNoneMatch: first.headers.ETag });

    expect(second.status).toBe(304);
    expect(second.body).toBeNull();
    // The whole point: a 304 must not fetch the object it is not sending.
    expect(read).toHaveBeenCalledTimes(1);
    // 304 carries the validators and deliberately no Content-Type or Length.
    expect(second.headers.ETag).toBe(first.headers.ETag);
    expect(second.headers["Content-Type"]).toBeUndefined();
    expect(second.headers["Content-Length"]).toBeUndefined();
  });

  it("round-trips the thumbnail's own tag, not the main one", async () => {
    const { service } = build(mediaRow());
    const { delivery } = deliveryWithStorage();

    const mainTarget = (await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main"))!;
    const thumbTarget = (await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "thumb"))!;

    const mainTag = (await delivery.serve(mainTarget)).headers.ETag;

    // The main image's validator must NOT satisfy a thumbnail request.
    const cross = await delivery.serve(thumbTarget, { ifNoneMatch: mainTag });
    expect(cross.status).toBe(200);

    const own = await delivery.serve(thumbTarget, {
      ifNoneMatch: (await delivery.serve(thumbTarget)).headers.ETag,
    });
    expect(own.status).toBe(304);
  });

  it("lets If-None-Match decide even when If-Modified-Since disagrees", async () => {
    // RFC 9110 §13.1.2: a recipient MUST ignore If-Modified-Since when the
    // request carries If-None-Match. Precedence here is a spec requirement,
    // not a preference — evaluating both would be a violation.
    const { service } = build(mediaRow());
    const { delivery, read } = deliveryWithStorage();
    const target = (await service.findOwnedTarget(COMPANY, PRODUCT, MEDIA, "main"))!;

    const tag = (await delivery.serve(target)).headers.ETag;
    read.mockClear();

    // A matching tag and a stale date: the tag wins, so 304.
    const matched = await delivery.serve(target, {
      ifNoneMatch: tag,
      ifModifiedSince: new Date("1990-01-01T00:00:00.000Z").toUTCString(),
    });
    expect(matched.status).toBe(304);
    expect(read).not.toHaveBeenCalled();

    // A non-matching tag and a fresh date: the tag wins again, so 200.
    const mismatched = await delivery.serve(target, {
      ifNoneMatch: 'W/"different"',
      ifModifiedSince: new Date("2099-01-01T00:00:00.000Z").toUTCString(),
    });
    expect(mismatched.status).toBe(200);
  });
});
