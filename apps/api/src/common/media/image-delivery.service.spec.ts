import { NotFoundException } from "@nestjs/common";
import {
  ImageDeliveryService,
  computeETag,
  formatETag,
  matchesIfModifiedSince,
  matchesIfNoneMatch,
  type ImageTarget,
} from "./image-delivery.service";
import type { StorageService } from "../../storage/storage.service";

const BYTES = Buffer.from("fake-image-bytes");
const LAST_MODIFIED = new Date("2026-08-20T10:00:00.000Z");

function makeService(read: jest.Mock = jest.fn().mockResolvedValue(BYTES)) {
  const storage = { read } as unknown as StorageService;
  return { service: new ImageDeliveryService(storage), read };
}

function target(overrides: Partial<ImageTarget> = {}): ImageTarget {
  return {
    objectKey: "banners/abc/main.jpg",
    contentType: "image/jpeg",
    etag: computeETag(BYTES),
    lastModified: LAST_MODIFIED,
    ...overrides,
  };
}

describe("ETag", () => {
  it("is a strong, correctly quoted entity-tag by default", () => {
    expect(formatETag("abc123")).toBe('"abc123"');
    expect(formatETag("abc123").startsWith("W/")).toBe(false);
  });

  it("emits a weak tag when the validator is not a byte digest", () => {
    expect(formatETag("abc123", true)).toBe('W/"abc123"');
    expect(formatETag("abc123", true)).toMatch(/^W\/".+"$/);
  });

  it("is derived from the bytes, so identical bytes yield identical tags", () => {
    expect(computeETag(BYTES)).toBe(computeETag(Buffer.from("fake-image-bytes")));
  });

  it("differs for different bytes — main and thumb can never collide", () => {
    expect(computeETag(Buffer.from("main"))).not.toBe(computeETag(Buffer.from("thumb")));
  });
});

describe("matchesIfNoneMatch", () => {
  it.each([
    ['"abc"', '"abc"', true],
    ["*", '"abc"', true],
    ['W/"abc"', '"abc"', true],
    ['"abc", "def"', '"def"', true],
    ['  "abc"  ', '"abc"', true],
    ['"zzz"', '"abc"', false],
    ['"ab"', '"abc"', false],
    ["", '"abc"', false],
  ])("header %s against %s → %s", (header, current, expected) => {
    expect(matchesIfNoneMatch(header, current)).toBe(expected);
  });

  describe("weak comparison (RFC 9110 §8.8.3.2)", () => {
    it("a weak tag matches ITSELF — the client echoes back what was sent", () => {
      // This is the case a one-sided strip gets wrong: the server sent
      // W/"abc", the client returns W/"abc", and both must compare
      // equal.
      expect(matchesIfNoneMatch('W/"abc"', 'W/"abc"')).toBe(true);
    });

    it("matches across weakness in both directions", () => {
      expect(matchesIfNoneMatch('"abc"', 'W/"abc"')).toBe(true);
      expect(matchesIfNoneMatch('W/"abc"', '"abc"')).toBe(true);
    });

    it("still refuses a different opaque tag, weak or strong", () => {
      expect(matchesIfNoneMatch('W/"zzz"', 'W/"abc"')).toBe(false);
      expect(matchesIfNoneMatch('"zzz"', 'W/"abc"')).toBe(false);
    });

    it("handles a weak tag inside a comma-separated list", () => {
      expect(matchesIfNoneMatch('W/"one", W/"two"', 'W/"two"')).toBe(true);
      expect(matchesIfNoneMatch('"one", W/"two"', 'W/"two"')).toBe(true);
    });
  });
});

describe("matchesIfModifiedSince", () => {
  it("reports not-modified when the date is at or after last-modified", () => {
    expect(matchesIfModifiedSince(LAST_MODIFIED.toUTCString(), LAST_MODIFIED)).toBe(true);
    expect(matchesIfModifiedSince(new Date("2026-08-21").toUTCString(), LAST_MODIFIED)).toBe(true);
  });

  it("reports modified when the date is older", () => {
    expect(matchesIfModifiedSince(new Date("2026-08-19").toUTCString(), LAST_MODIFIED)).toBe(false);
  });

  it("ignores an unparseable date rather than treating it as a match", () => {
    expect(matchesIfModifiedSince("not-a-date", LAST_MODIFIED)).toBe(false);
  });

  it("tolerates sub-second precision loss in HTTP-date", () => {
    const withMillis = new Date("2026-08-20T10:00:00.750Z");
    expect(matchesIfModifiedSince(withMillis.toUTCString(), withMillis)).toBe(true);
  });
});

describe("serve", () => {
  it("returns 200 with the bytes and full headers", async () => {
    const { service } = makeService();

    const result = await service.serve(target());

    expect(result.status).toBe(200);
    expect(result.body).toBe(BYTES);
    expect(result.headers["Content-Type"]).toBe("image/jpeg");
    expect(result.headers["Content-Length"]).toBe(String(BYTES.byteLength));
    expect(result.headers["Cache-Control"]).toContain("max-age=300");
    expect(result.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(result.headers["Accept-Ranges"]).toBe("none");
    expect(result.headers.ETag).toBe(formatETag(computeETag(BYTES)));
  });

  it("returns 304 with no body when If-None-Match matches", async () => {
    const { service, read } = makeService();
    const etag = formatETag(computeETag(BYTES));

    const result = await service.serve(target(), { ifNoneMatch: etag });

    expect(result.status).toBe(304);
    expect(result.body).toBeNull();
    expect(result.headers.ETag).toBe(etag);
    expect(result.headers["Last-Modified"]).toBeDefined();
    expect(result.headers["Content-Type"]).toBeUndefined();
    expect(result.headers["Content-Length"]).toBeUndefined();
    // The object is never read when the client already has it.
    expect(read).not.toHaveBeenCalled();
  });

  it("returns 200 when If-None-Match does not match", async () => {
    const { service } = makeService();

    const result = await service.serve(target(), { ifNoneMatch: '"stale"' });

    expect(result.status).toBe(200);
    expect(result.body).toBe(BYTES);
  });

  it("IGNORES If-Modified-Since when If-None-Match is present (RFC 9110)", async () => {
    const { service } = makeService();

    // The date says "not modified", the tag says "modified". The tag wins.
    const result = await service.serve(target(), {
      ifNoneMatch: '"stale"',
      ifModifiedSince: new Date("2027-01-01").toUTCString(),
    });

    expect(result.status).toBe(200);
  });

  it("honours If-Modified-Since only when If-None-Match is absent", async () => {
    const { service } = makeService();

    const result = await service.serve(target(), {
      ifModifiedSince: LAST_MODIFIED.toUTCString(),
    });

    expect(result.status).toBe(304);
  });

  it("404s on an untrusted stored content type instead of serving it", async () => {
    const { service, read } = makeService();

    for (const contentType of ["image/svg+xml", "text/html", "application/javascript", ""]) {
      await expect(service.serve(target({ contentType }))).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("404s — never 500s — when the object cannot be read", async () => {
    const { service } = makeService(jest.fn().mockRejectedValue(new Error("NoSuchKey")));

    await expect(service.serve(target())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("emits a WEAK tag and honours it for 304 when weakETag is set", async () => {
    const { service, read } = makeService();
    const weakTarget = target({ weakETag: true });
    const expected = formatETag(weakTarget.etag, true);

    const first = await service.serve(weakTarget);
    expect(first.headers.ETag).toBe(expected);
    expect(first.headers.ETag.startsWith('W/"')).toBe(true);

    read.mockClear();
    const second = await service.serve(weakTarget, { ifNoneMatch: expected });

    expect(second.status).toBe(304);
    expect(second.body).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps a STRONG tag when weakETag is absent or false", async () => {
    const { service } = makeService();

    const implicit = await service.serve(target());
    const explicit = await service.serve(target({ weakETag: false }));

    expect(implicit.headers.ETag.startsWith("W/")).toBe(false);
    expect(explicit.headers.ETag.startsWith("W/")).toBe(false);
  });

  it("refuses a 304 via If-Modified-Since when a NON-MATCHING If-None-Match is present", async () => {
    const { service } = makeService();

    // The date alone would say "not modified". The tag says otherwise,
    // and per RFC 9110 the tag is the only one consulted.
    const result = await service.serve(target(), {
      ifNoneMatch: '"stale"',
      ifModifiedSince: new Date("2030-01-01").toUTCString(),
    });

    expect(result.status).toBe(200);
    expect(result.body).not.toBeNull();
  });

  it("never echoes the object key in the response", async () => {
    const { service } = makeService();

    const result = await service.serve(target({ objectKey: "banners/SECRET-KEY/main.jpg" }));

    expect(JSON.stringify(result.headers)).not.toContain("SECRET-KEY");
  });
});
