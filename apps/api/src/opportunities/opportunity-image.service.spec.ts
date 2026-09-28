import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  OpportunityImageService,
  contentTypeFromObjectKey,
  etagForObjectKey,
} from "./opportunity-image.service";
import type { PrismaService } from "../database/prisma.service";
import { formatETag, matchesIfNoneMatch } from "../common/media/image-delivery.service";
import type { OpportunitySettingsService } from "../settings/opportunity-settings.service";

const APPROVED_AT = new Date("2026-08-01T00:00:00.000Z");

function snapshotWith(media: unknown) {
  return { productApprovalSnapshot: { snapshot: { media }, approvedAt: APPROVED_AT } };
}

function makeService(row: unknown, showScheduled = false) {
  const findFirst = jest.fn().mockResolvedValue(row);
  const prisma = { opportunity: { findFirst } } as unknown as PrismaService;
  const settings = {
    getConfig: jest.fn().mockResolvedValue({ showScheduledPubliclyEnabled: showScheduled }),
  } as unknown as OpportunitySettingsService;

  return { service: new OpportunityImageService(prisma, settings), findFirst };
}

const MEDIA = [
  { objectKey: "products/p1/aaa.jpg", thumbnailObjectKey: "products/p1/aaa-thumb.jpg", isMain: true, sortOrder: 0 },
];

describe("contentTypeFromObjectKey", () => {
  it.each([
    ["products/p1/x.jpg", "image/jpeg"],
    ["products/p1/x.jpeg", "image/jpeg"],
    ["products/p1/x.png", "image/png"],
    ["products/p1/x.webp", "image/webp"],
    ["products/p1/x.JPG", "image/jpeg"],
  ])("maps %s to %s", (key, expected) => {
    expect(contentTypeFromObjectKey(key)).toBe(expected);
  });

  it.each([
    ["no extension", "products/p1/x"],
    ["svg", "products/p1/x.svg"],
    ["html", "products/p1/x.html"],
    ["gif", "products/p1/x.gif"],
    ["bin fallback", "products/p1/x.bin"],
    ["empty", ""],
    ["dot only", "products/p1/x."],
  ])("refuses %s", (_label, key) => {
    expect(contentTypeFromObjectKey(key)).toBeNull();
  });
});

describe("etagForObjectKey", () => {
  it("is stable for a given key", () => {
    expect(etagForObjectKey("a/b.jpg")).toBe(etagForObjectKey("a/b.jpg"));
  });

  it("differs between main and thumb, which are different keys", () => {
    expect(etagForObjectKey("a/b.jpg")).not.toBe(etagForObjectKey("a/b-thumb.jpg"));
  });

  it("is a 64-character hex digest", () => {
    expect(etagForObjectKey("a/b.jpg")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never contains the key itself", () => {
    expect(etagForObjectKey("products/SECRET/x.jpg")).not.toContain("SECRET");
    expect(etagForObjectKey("products/SECRET/x.jpg")).not.toContain("products");
    expect(etagForObjectKey("products/SECRET/x.jpg")).not.toContain(".jpg");
  });

  it("differs for a different key", () => {
    expect(etagForObjectKey("products/p1/a.jpg")).not.toBe(etagForObjectKey("products/p1/b.jpg"));
  });
});

describe("opportunity image tags are WEAK", () => {
  it("marks the target weak, because the tag is not a byte digest", async () => {
    const { service } = makeService(snapshotWith(MEDIA));

    const target = await service.findPublicTarget("o1", "main");

    expect(target!.weakETag).toBe(true);
  });

  it("formats as W/\"…\" once served", () => {
    const hex = etagForObjectKey("products/p1/aaa.jpg");

    expect(formatETag(hex, true)).toBe(`W/"${hex}"`);
    expect(formatETag(hex, true).startsWith('W/"')).toBe(true);
    expect(formatETag(hex, true).endsWith('"')).toBe(true);
  });

  it("still round-trips through If-None-Match to a 304", () => {
    const hex = etagForObjectKey("products/p1/aaa.jpg");
    const served = formatETag(hex, true);

    expect(matchesIfNoneMatch(served, served)).toBe(true);
  });

  it("marks BOTH variants weak", async () => {
    const { service } = makeService(snapshotWith(MEDIA));

    const main = await service.findPublicTarget("o1", "main");
    const thumb = await service.findPublicTarget("o1", "thumb");

    expect(main!.weakETag).toBe(true);
    expect(thumb!.weakETag).toBe(true);
  });
});

describe("findPublicTarget", () => {
  it("resolves the main variant", async () => {
    const { service } = makeService(snapshotWith(MEDIA));

    const target = await service.findPublicTarget("o1", "main");

    expect(target).toEqual({
      objectKey: "products/p1/aaa.jpg",
      contentType: "image/jpeg",
      etag: etagForObjectKey("products/p1/aaa.jpg"),
      weakETag: true,
      lastModified: APPROVED_AT,
    });
  });

  it("resolves the thumb variant to a different key and ETag", async () => {
    const { service } = makeService(snapshotWith(MEDIA));

    const main = await service.findPublicTarget("o1", "main");
    const thumb = await service.findPublicTarget("o1", "thumb");

    expect(thumb!.objectKey).toBe("products/p1/aaa-thumb.jpg");
    expect(thumb!.etag).not.toBe(main!.etag);
  });

  it("uses the frozen snapshot's approvedAt as the validator timestamp", async () => {
    const { service } = makeService(snapshotWith(MEDIA));

    const target = await service.findPublicTarget("o1", "main");

    expect(target!.lastModified).toBe(APPROVED_AT);
  });

  it.each([
    ["an unknown or non-visible opportunity", null],
    ["an opportunity with no snapshot", { productApprovalSnapshot: null }],
    ["a legacy snapshot with no media key", { productApprovalSnapshot: { snapshot: { salesUnitId: "x" }, approvedAt: APPROVED_AT } }],
    ["an empty media array", snapshotWith([])],
    ["media that is not an array", snapshotWith("none")],
  ])("returns null for %s", async (_label, row) => {
    const { service } = makeService(row);

    await expect(service.findPublicTarget("o1", "main")).resolves.toBeNull();
  });

  it("returns null for a key whose extension is not servable", async () => {
    const { service } = makeService(
      snapshotWith([
        { objectKey: "products/p1/x.svg", thumbnailObjectKey: "products/p1/x-thumb.svg", isMain: true, sortOrder: 0 },
      ])
    );

    await expect(service.findPublicTarget("o1", "main")).resolves.toBeNull();
  });

  it("restricts to ACTIVE by default", async () => {
    const { service, findFirst } = makeService(snapshotWith(MEDIA), false);

    await service.findPublicTarget("o1", "main");

    expect(findFirst.mock.calls[0][0].where.status.in).toEqual(["ACTIVE"]);
  });

  it("includes SCHEDULED only when the setting allows it", async () => {
    const { service, findFirst } = makeService(snapshotWith(MEDIA), true);

    await service.findPublicTarget("o1", "main");

    expect(findFirst.mock.calls[0][0].where.status.in).toEqual(["ACTIVE", "SCHEDULED"]);
  });

  it("never selects commercial columns for an image lookup", async () => {
    const { service, findFirst } = makeService(snapshotWith(MEDIA));

    await service.findPublicTarget("o1", "main");

    const select = findFirst.mock.calls[0][0].select as Record<string, unknown>;
    expect(Object.keys(select)).toEqual(["productApprovalSnapshot"]);
    for (const commercial of ["unitPriceAmount", "targetQuantity", "fundedQuantity", "shareQuantity"]) {
      expect(select).not.toHaveProperty(commercial);
    }
  });
});

/**
 * THE GALLERY'S OWN QUERY.
 *
 * The detail page lists every photograph in the frozen snapshot and
 * addresses each by index on THIS route — not on a second endpoint, so
 * the n-th url and the n-th image cannot disagree.
 *
 * THE DTO IS WHY THIS EXISTS. The application runs `ValidationPipe`
 * with `whitelist` and `forbidNonWhitelisted`, so a query parameter no
 * DTO names is a 400 before the handler runs. The first attempt read
 * `index` off a cast inside the controller: every indexed request
 * answered 400, the page rendered empty boxes, and nothing in the code
 * said why. The pipe was right; the cast was the bug.
 */
describe("the indexed gallery", () => {
  it("names `index` on the route's own DTO, so the pipe lets it through", () => {
    const dto = readFileSync(
      join(__dirname, "dto/opportunity-image-query.dto.ts"),
      "utf8",
    );

    // DECLARED, not read around: a cast in the controller cannot get a
    // parameter past `forbidNonWhitelisted`.
    expect(dto).toContain("index?: number");
    expect(dto).toContain("extends ImageVariantQueryDto");
    // A BAD INDEX IS A 400, the same rule `variant` follows — never a
    // quiet fall back to a different photograph.
    expect(dto).toContain("@IsInt(");
    expect(dto).toContain("@Min(0");

    const controller = readFileSync(
      join(__dirname, "opportunity-image.controller.ts"),
      "utf8",
    );
    expect(controller).toContain("OpportunityImageQueryDto");
    expect(controller).toContain("query.index");
    // The cast that caused it must not come back.
    expect(controller).not.toMatch(/as \{ index\?/);
  });
});
