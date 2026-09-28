import { Logger, NotFoundException } from "@nestjs/common";
import { BrandAssetService, BRAND_LOGO_LIMITS } from "./brand-asset.service";
import {
  BRAND_LOGO_LIMITS as SHARED_LIMITS,
  ERROR_CODES,
} from "@platform/types";
import { BusinessException } from "../common/errors/business-exception";
import type { PrismaService } from "../database/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { StorageService } from "../storage/storage.service";

/**
 * The header logo, as a set of two languages.
 *
 * What these pin down is mostly ORDERING and REFUSALS: storage and the
 * database cannot share a transaction, so the only thing standing
 * between a failed upload and a header pointing at bytes that were
 * never written is the sequence the service performs. Each test below
 * reads a recorded trace rather than asserting on mock call counts,
 * because the ORDER is the property being defended.
 */

const AR = "ar-SA" as const;
const EN = "en-SA" as const;

const CTX = { actorId: "admin-1", requestId: "req-1" };

const MAIN = Buffer.from("logo-main-bytes");
const THUMB = Buffer.from("logo-thumb-bytes");

jest.mock("../common/media/image-processing.util", () => {
  const actual = jest.requireActual("../common/media/image-processing.util");
  return { ...actual, processImage: jest.fn() };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { processImage, InvalidImageError } = require("../common/media/image-processing.util");

interface Row {
  locale: "AR_SA" | "EN_SA";
  objectKey: string;
  thumbnailKey: string;
  contentType: string;
  etag: string;
  thumbnailETag: string;
  width: number;
  height: number;
  publishedAt: Date | null;
  updatedAt: Date;
}

function row(locale: "AR_SA" | "EN_SA", overrides: Partial<Row> = {}): Row {
  const slug = locale.toLowerCase();
  return {
    locale,
    objectKey: `brand/logo/${slug}/old.png`,
    thumbnailKey: `brand/logo/${slug}/old-thumb.png`,
    contentType: "image/png",
    etag: "etag-old",
    thumbnailETag: "etag-old-thumb",
    width: 240,
    height: 64,
    publishedAt: null,
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeService(
  rows: Row[] = [],
  options: { writeThrows?: boolean; deleteThrows?: boolean } = {},
) {
  const trace: string[] = [];
  const store = new Map(rows.map((r) => [r.locale, r]));

  const findUnique = jest.fn(
    async (args: { where: { locale: "AR_SA" | "EN_SA" } }) => {
      return store.get(args.where.locale) ?? null;
    },
  );

  const findMany = jest.fn(async () => [...store.values()]);

  const upsert = jest.fn(
    async (args: { where: { locale: Row["locale"] }; create: Row }) => {
      trace.push("DB_WRITE");
      if (options.writeThrows) throw new Error("db write failed");
      const merged = { ...row(args.where.locale), ...args.create };
      store.set(args.where.locale, merged);
      return merged;
    },
  );

  const updateMany = jest.fn(async (args: { data: { publishedAt: Date } }) => {
    trace.push("DB_PUBLISH");
    for (const [key, value] of store)
      store.set(key, { ...value, ...args.data });
    return { count: store.size };
  });

  const deleteMany = jest.fn(async () => {
    trace.push("DB_DELETE");
    const count = store.size;
    store.clear();
    return { count };
  });

  const audited: { action: string; payload: unknown }[] = [];
  const auditLog = jest.fn(
    async (input: {
      action: string;
      before?: unknown;
      after?: unknown;
    }): Promise<void> => {
      trace.push("AUDIT");
      audited.push({ action: input.action, payload: { ...input } });
    },
  );

  const model = { findUnique, findMany, upsert, updateMany, deleteMany };

  const prisma = {
    brandAsset: model,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      trace.push("TX_BEGIN");
      const result = await fn({ brandAsset: model });
      trace.push("TX_COMMIT");
      return result;
    }),
  } as unknown as PrismaService;

  const put: string[] = [];
  const removed: string[] = [];
  const storage = {
    upload: jest.fn(async (key: string) => {
      trace.push("PUT");
      put.push(key);
    }),
    delete: jest.fn(async (key: string) => {
      trace.push("DEL");
      if (options.deleteThrows) throw new Error("storage unreachable");
      removed.push(key);
    }),
  } as unknown as StorageService;

  const service = new BrandAssetService(
    prisma,
    { log: auditLog } as unknown as AuditService,
    storage,
  );

  return { service, trace, put, removed, audited, store, storage };
}

/**
 * What a refusal actually carries.
 *
 * `BusinessException` extends `HttpException`, so the code lives in the
 * response BODY rather than on the object — `err.code` is `undefined`
 * and an assertion on it passes for the wrong reason.
 */
async function refusalFrom(work: Promise<unknown>) {
  try {
    await work;
  } catch (err) {
    const failure = err as BusinessException;
    const body = failure.getResponse() as { code: string; message: string };
    return {
      status: failure.getStatus(),
      code: body.code,
      message: body.message,
    };
  }
  throw new Error("expected the upload to be refused, and it was not");
}

beforeEach(() => {
  processImage.mockReset();
  processImage.mockResolvedValue({
    mainBuffer: MAIN,
    thumbnailBuffer: THUMB,
    contentType: "image/png",
    width: 240,
    height: 64,
  });
});

describe("what a logo is allowed to be", () => {
  it("accepts PNG and WebP, and states it once", () => {
    // The same list the database CHECK and the file picker use. A third
    // copy here is how they drift.
    expect(BRAND_LOGO_LIMITS.allowedTypes).toEqual(["image/png", "image/webp"]);
  });

  it("takes its ceilings from the SHARED contract, not a private copy", () => {
    // The screen tells the operator "at most 2 MB, at least 64x32" from
    // the same constant. Two copies drift, and the first symptom is a
    // panel promising one limit while the server enforces another.
    expect(BRAND_LOGO_LIMITS.maxSizeBytes).toBe(SHARED_LIMITS.maxSizeBytes);
    expect(BRAND_LOGO_LIMITS.minWidth).toBe(SHARED_LIMITS.minWidth);
    expect(BRAND_LOGO_LIMITS.minHeight).toBe(SHARED_LIMITS.minHeight);
    expect(BRAND_LOGO_LIMITS.maxPixels).toBe(SHARED_LIMITS.maxPixels);
  });

  it("is generous enough for an ordinary logo export", () => {
    // The first real upload was an 863KB PNG and the second 1.07MB —
    // unremarkable sizes for a wordmark exported with an alpha channel,
    // and both were refused by a 512KB ceiling. The stored file is
    // re-encoded and capped at 2000px regardless, so this number bounds
    // only what gets DECODED, and `maxPixels` is what really bounds
    // that.
    expect(BRAND_LOGO_LIMITS.maxSizeBytes).toBeGreaterThanOrEqual(1_200_000);
  });

  it("refuses bytes over the size ceiling before touching storage", async () => {
    const { service, trace } = makeService();
    const huge = Buffer.alloc(BRAND_LOGO_LIMITS.maxSizeBytes + 1);

    // NOT `VALIDATION_FAILED`: the web app may only key a message off
    // the code, so one code for four causes is exactly how an oversized
    // logo became "the submitted data is not valid".
    expect(await refusalFrom(service.upload(AR, huge, CTX))).toMatchObject({
      code: ERROR_CODES.BRAND_LOGO_TOO_LARGE,
      status: 400,
    });
    // Not decoded either: a refusal that still decodes megabytes of
    // attacker-chosen input is not much of a refusal.
    expect(processImage).not.toHaveBeenCalled();
    expect(trace).toEqual([]);
  });

  it("refuses something that is not an image, and writes nothing", async () => {
    const { service, trace } = makeService();
    processImage.mockRejectedValue(
      new InvalidImageError("bad type", "TYPE_NOT_ALLOWED"),
    );

    expect(
      await refusalFrom(service.upload(AR, Buffer.from("not-an-image"), CTX)),
    ).toMatchObject({ code: ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED });
    expect(trace).toEqual([]);
  });

  it.each([
    ["UNDECODABLE", ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED],
    ["TYPE_NOT_ALLOWED", ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED],
    ["DIMENSIONS_UNREADABLE", ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED],
    ["TOO_MANY_PIXELS", ERROR_CODES.BRAND_LOGO_TOO_MANY_PIXELS],
  ])("turns a %s decode rejection into %s", async (reason, code) => {
    const { service } = makeService();
    processImage.mockRejectedValue(new InvalidImageError("rejected", reason));

    expect(
      await refusalFrom(service.upload(AR, Buffer.from("bytes"), CTX)),
    ).toMatchObject({
      code,
    });
  });

  it("falls back to the type code for a rejection carrying no reason", async () => {
    // Every path in `processImage` labels itself today. This guards the
    // one someone adds tomorrow without a label: it must still produce
    // a usable message rather than an undefined code.
    const { service } = makeService();
    processImage.mockRejectedValue(new InvalidImageError("unlabelled"));

    expect(
      await refusalFrom(service.upload(AR, Buffer.from("bytes"), CTX)),
    ).toMatchObject({
      code: ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED,
    });
  });

  it("refuses artwork below the minimum, AFTER decoding and before storing", async () => {
    // The dimensions are only knowable once decoded, so this refusal
    // necessarily comes later — but it still comes before any PUT.
    const { service, trace } = makeService();
    processImage.mockResolvedValue({
      mainBuffer: MAIN,
      thumbnailBuffer: THUMB,
      contentType: "image/png",
      width: BRAND_LOGO_LIMITS.minWidth - 1,
      height: BRAND_LOGO_LIMITS.minHeight,
    });

    expect(
      await refusalFrom(service.upload(AR, Buffer.from("tiny"), CTX)),
    ).toMatchObject({
      code: ERROR_CODES.BRAND_LOGO_TOO_SMALL,
    });
    expect(trace).toEqual([]);
  });

  it("keeps every refusal distinguishable from every other", async () => {
    // The property that was missing: four causes, four codes. One
    // repeated code here puts the panel straight back on a message that
    // says nothing about what to do next.
    const codes = new Set<string>();

    const tooBig = makeService();
    codes.add(
      (
        await refusalFrom(
          tooBig.service.upload(
            AR,
            Buffer.alloc(BRAND_LOGO_LIMITS.maxSizeBytes + 1),
            CTX,
          ),
        )
      ).code,
    );

    for (const reason of ["TYPE_NOT_ALLOWED", "TOO_MANY_PIXELS"] as const) {
      const svc = makeService();
      processImage.mockRejectedValue(new InvalidImageError("rejected", reason));
      codes.add(
        (await refusalFrom(svc.service.upload(AR, Buffer.from("x"), CTX))).code,
      );
    }

    const tooSmall = makeService();
    processImage.mockResolvedValue({
      mainBuffer: MAIN,
      thumbnailBuffer: THUMB,
      contentType: "image/png",
      width: 10,
      height: 10,
    });
    codes.add(
      (await refusalFrom(tooSmall.service.upload(AR, Buffer.from("x"), CTX)))
        .code,
    );

    expect(codes.size).toBe(4);
    expect(codes.has(ERROR_CODES.VALIDATION_FAILED)).toBe(false);
  });

  it("never consults the client's declared type — only the decoded bytes", async () => {
    const { service, store } = makeService();
    processImage.mockResolvedValue({
      mainBuffer: MAIN,
      thumbnailBuffer: THUMB,
      // Claimed PNG by a filename; decoded as WebP. The decoded answer
      // is what is stored and what the key extension follows.
      contentType: "image/webp",
      width: 240,
      height: 64,
    });

    await service.upload(AR, Buffer.from("bytes"), CTX);

    expect(store.get("AR_SA")!.contentType).toBe("image/webp");
    expect(store.get("AR_SA")!.objectKey.endsWith(".webp")).toBe(true);
  });
});

describe("uploading orders storage and the database so no failure strands a reader", () => {
  it("writes the objects first, then commits the row", async () => {
    const { service, trace } = makeService();

    await service.upload(AR, Buffer.from("bytes"), CTX);

    // Both objects exist before the row that names them. The reverse
    // would leave a committed row pointing at bytes that are not there.
    expect(trace).toEqual([
      "PUT",
      "PUT",
      "TX_BEGIN",
      "DB_WRITE",
      "AUDIT",
      "TX_COMMIT",
    ]);
  });

  it("stores under a FRESH key, leaving the old object readable until commit", async () => {
    const existing = row("AR_SA");
    const { service, put, trace } = makeService([existing]);

    await service.upload(AR, Buffer.from("bytes"), CTX);

    expect(put).toHaveLength(2);
    expect(put).not.toContain(existing.objectKey);
    expect(put).not.toContain(existing.thumbnailKey);
    // And the old bytes are dropped only after the commit.
    expect(trace.indexOf("TX_COMMIT")).toBeLessThan(trace.indexOf("DEL"));
  });

  it("removes the OLD objects once the row commits", async () => {
    const existing = row("AR_SA");
    const { service, removed } = makeService([existing]);

    await service.upload(AR, Buffer.from("bytes"), CTX);

    expect(removed).toEqual([existing.objectKey, existing.thumbnailKey]);
  });

  it("removes the NEW objects when the row write fails, and keeps the old ones", async () => {
    const existing = row("AR_SA");
    const { service, put, removed } = makeService([existing], {
      writeThrows: true,
    });

    await expect(service.upload(AR, Buffer.from("bytes"), CTX)).rejects.toThrow(
      "db write failed",
    );

    // Exactly the two just written, so the previous logo still resolves.
    expect(removed).toEqual(put);
    expect(removed).not.toContain(existing.objectKey);
  });

  it("keeps a language's keys under that language's prefix", async () => {
    const { service, put } = makeService();

    await service.upload(EN, Buffer.from("bytes"), CTX);

    for (const key of put)
      expect(key.startsWith(`brand/logo/${EN}/`)).toBe(true);
  });

  it("does not disturb the other language", async () => {
    const other = row("EN_SA", {
      publishedAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    const { service, store } = makeService([row("AR_SA"), other]);

    await service.upload(AR, Buffer.from("bytes"), CTX);

    expect(store.get("EN_SA")).toEqual(other);
  });
});

describe("the audit trail records what happened without becoming a key index", () => {
  it("distinguishes a first upload from a replacement", async () => {
    const first = makeService();
    await first.service.upload(AR, Buffer.from("bytes"), CTX);
    expect(first.audited.map((entry) => entry.action)).toEqual([
      "BRAND_LOGO_UPLOADED",
    ]);

    const again = makeService([row("AR_SA")]);
    await again.service.upload(AR, Buffer.from("bytes"), CTX);
    expect(again.audited.map((entry) => entry.action)).toEqual([
      "BRAND_LOGO_REPLACED",
    ]);
  });

  it("names no storage key in any event it writes", async () => {
    const { service, audited, store } = makeService([
      row("AR_SA"),
      row("EN_SA"),
    ]);

    await service.upload(AR, Buffer.from("bytes"), CTX);
    const stored = store.get("AR_SA")!;
    await service.publish(CTX);
    await service.deleteAll(CTX);

    expect(audited).toHaveLength(3);
    const serialized = JSON.stringify(audited);
    for (const key of [stored.objectKey, stored.thumbnailKey, "brand/logo/"]) {
      expect(serialized).not.toContain(key);
    }
  });

  it("commits the event with the write, not beside it", async () => {
    const { service, trace } = makeService();

    await service.upload(AR, Buffer.from("bytes"), CTX);

    const begin = trace.indexOf("TX_BEGIN");
    const commit = trace.indexOf("TX_COMMIT");
    expect(trace.indexOf("AUDIT")).toBeGreaterThan(begin);
    expect(trace.indexOf("AUDIT")).toBeLessThan(commit);
  });
});

describe("publishing takes the set or nothing", () => {
  it("refuses while a language is missing, and says which", async () => {
    const { service, trace } = makeService([row("AR_SA")]);

    await expect(service.publish(CTX)).rejects.toMatchObject({
      message: expect.stringContaining(EN),
    });
    // Nothing was published and nothing was recorded.
    expect(trace).not.toContain("DB_PUBLISH");
    expect(trace).not.toContain("AUDIT");
  });

  it("refuses an empty set", async () => {
    const { service } = makeService();
    await expect(service.publish(CTX)).rejects.toBeInstanceOf(
      BusinessException,
    );
  });

  it("checks and writes inside ONE transaction", async () => {
    // Otherwise a delete landing between the check and the write would
    // publish a set that is no longer complete.
    const { service, trace } = makeService([row("AR_SA"), row("EN_SA")]);

    await service.publish(CTX);

    expect(trace).toEqual(["TX_BEGIN", "DB_PUBLISH", "AUDIT", "TX_COMMIT"]);
  });

  it("stamps both languages with the same instant", async () => {
    const { service, store } = makeService([row("AR_SA"), row("EN_SA")]);

    await service.publish(CTX);

    const stamps = [...store.values()].map((r) => r.publishedAt?.toISOString());
    expect(stamps).toHaveLength(2);
    expect(new Set(stamps).size).toBe(1);
    expect(stamps[0]).toBeDefined();
  });
});

describe("the public read shows only what was published, and never substitutes", () => {
  it("hides a logo that exists but has not been published", async () => {
    const { service } = makeService([row("AR_SA", { publishedAt: null })]);

    expect(await service.findPublished(AR)).toBeNull();
    expect(await service.hasPublished(AR)).toBe(false);
  });

  it("returns the published one", async () => {
    const at = new Date("2026-08-03T00:00:00.000Z");
    const { service } = makeService([row("AR_SA", { publishedAt: at })]);

    expect(await service.findPublished(AR)).toMatchObject({
      objectKey: "brand/logo/ar_sa/old.png",
      contentType: "image/png",
    });
    expect(await service.hasPublished(AR)).toBe(true);
  });

  it("does NOT fall back to the other language", async () => {
    // A blank placeholder is correct here. Showing the English mark on
    // an Arabic page would be a substitution nobody asked for.
    const { service } = makeService([
      row("EN_SA", { publishedAt: new Date() }),
    ]);

    expect(await service.findPublished(AR)).toBeNull();
    expect(await service.hasPublished(AR)).toBe(false);
  });

  it("lets an admin preview an unpublished logo", async () => {
    const { service } = makeService([row("AR_SA", { publishedAt: null })]);

    expect(await service.findForAdmin(AR)).not.toBeNull();
  });
});

describe("the identity screen's view of the set", () => {
  it("reports incomplete while one language is missing", async () => {
    const { service } = makeService([
      row("AR_SA", { publishedAt: new Date() }),
    ]);

    const view = await service.listForAdmin();
    expect(view.complete).toBe(false);
    expect(view.published).toBe(false);
  });

  it("reports complete-but-unpublished when both exist and neither is live", async () => {
    const { service } = makeService([row("AR_SA"), row("EN_SA")]);

    const view = await service.listForAdmin();
    expect(view.complete).toBe(true);
    expect(view.published).toBe(false);
  });

  it("reports published only when every language is", async () => {
    const at = new Date("2026-08-04T00:00:00.000Z");
    const { service } = makeService([
      row("AR_SA", { publishedAt: at }),
      row("EN_SA", { publishedAt: null }),
    ]);

    expect((await service.listForAdmin()).published).toBe(false);
  });

  it("returns the language CODES, and no storage key", async () => {
    const { service } = makeService([row("AR_SA"), row("EN_SA")]);

    const view = await service.listForAdmin();
    expect(view.assets.map((asset) => asset.locale).sort()).toEqual([AR, EN]);
    expect(JSON.stringify(view)).not.toContain("brand/logo/");
  });
});

describe("deleting removes the pair", () => {
  it("refuses when there is nothing to delete", async () => {
    const { service } = makeService();
    await expect(service.deleteAll(CTX)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("clears the rows first, then the objects", async () => {
    const { service, trace, removed } = makeService([
      row("AR_SA"),
      row("EN_SA"),
    ]);

    await service.deleteAll(CTX);

    expect(trace).toEqual([
      "TX_BEGIN",
      "DB_DELETE",
      "AUDIT",
      "TX_COMMIT",
      "DEL",
      "DEL",
      "DEL",
      "DEL",
    ]);
    // Full-size AND derived, for both languages.
    expect(removed).toHaveLength(4);
    expect(removed.filter((key) => key.includes("-thumb"))).toHaveLength(2);
  });

  it("takes both languages even when only one was published", async () => {
    const { service, store } = makeService([
      row("AR_SA", { publishedAt: new Date() }),
      row("EN_SA"),
    ]);

    await service.deleteAll(CTX);

    expect(store.size).toBe(0);
  });

  it("still succeeds when storage cleanup fails, and logs no key", async () => {
    // The rows are gone as far as every reader is concerned. Failing
    // the request would report a failure for work that succeeded.
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const { service, store } = makeService([row("AR_SA"), row("EN_SA")], {
      deleteThrows: true,
    });

    await expect(service.deleteAll(CTX)).resolves.toBeUndefined();
    expect(store.size).toBe(0);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("4");
    expect(message).not.toContain("brand/logo/");
    warn.mockRestore();
  });
});
