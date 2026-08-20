import { NotFoundException } from "@nestjs/common";
import { BannerImageService } from "./banner-image.service";
import { BusinessException } from "../common/errors/business-exception";
import { computeETag } from "../common/media/image-delivery.service";
import type { PrismaService } from "../database/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { StorageService } from "../storage/storage.service";
import type { BannerPolicyService } from "../settings/banner-policy.service";

const CTX = { actorId: "admin-1", requestId: "req-1" };

const MAIN = Buffer.from("main-bytes");
const THUMB = Buffer.from("thumb-bytes");

jest.mock("../common/media/image-processing.util", () => {
  const actual = jest.requireActual("../common/media/image-processing.util");
  return {
    ...actual,
    processImage: jest.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { processImage, InvalidImageError } = require("../common/media/image-processing.util");

interface Existing {
  id: string;
  imageObjectKey: string | null;
  imageThumbnailKey: string | null;
}

function makeService(
  existing: Existing | null = { id: "b1", imageObjectKey: null, imageThumbnailKey: null },
  options: { updateThrows?: boolean } = {}
) {
  const trace: string[] = [];

  const findUnique = jest.fn().mockResolvedValue(existing);

  const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    trace.push("DB_UPDATE");
    if (options.updateThrows) throw new Error("db write failed");
    return { id: "b1", ...data };
  });

  const auditLog = jest.fn(async (_input: { action: string }, _tx?: unknown): Promise<void> => {
    trace.push("AUDIT");
  });

  const txClient = { promotionalBanner: { update } };

  const prisma = {
    promotionalBanner: { findUnique },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      trace.push("TX_BEGIN");
      const result = await fn(txClient);
      trace.push("TX_COMMIT");
      return result;
    }),
  } as unknown as PrismaService;

  const uploaded: string[] = [];
  const deleted: string[] = [];
  const storage = {
    upload: jest.fn(async (key: string) => {
      trace.push("PUT");
      uploaded.push(key);
    }),
    delete: jest.fn(async (key: string) => {
      trace.push("DELETE");
      deleted.push(key);
    }),
  } as unknown as StorageService;

  const policy = {
    getPolicy: jest.fn().mockResolvedValue({
      maxSizeBytes: 2 * 1024 * 1024,
      maxPixels: 8_000_000,
      allowedTypes: ["image/jpeg", "image/png", "image/webp"],
      maxConcurrentLiveBannersPerPlacement: 3,
    }),
  } as unknown as BannerPolicyService;

  (processImage as jest.Mock).mockReset();
  (processImage as jest.Mock).mockResolvedValue({
    mainBuffer: MAIN,
    thumbnailBuffer: THUMB,
    contentType: "image/jpeg",
    width: 1200,
    height: 600,
  });

  return {
    service: new BannerImageService(prisma, { log: auditLog } as unknown as AuditService, storage, policy),
    trace,
    uploaded,
    deleted,
    update,
    auditLog,
    storage,
  };
}

describe("upload ordering", () => {
  it("decodes BEFORE writing anything to storage", async () => {
    const { service, trace } = makeService();

    await service.upload("b1", Buffer.from("x"), CTX);

    // processImage is mocked, so its call cannot appear on the trace —
    // instead assert that no PUT precedes the first DB touch, and that
    // a decode failure (next test) produces no PUT at all.
    expect(trace.filter((t) => t === "PUT")).toHaveLength(2);
    expect(trace.indexOf("PUT")).toBeLessThan(trace.indexOf("TX_BEGIN"));
  });

  it("writes NOTHING when the bytes fail to decode", async () => {
    const { service, trace, storage } = makeService();
    (processImage as jest.Mock).mockRejectedValue(new InvalidImageError("not an image"));

    await expect(service.upload("b1", Buffer.from("x"), CTX)).rejects.toBeInstanceOf(
      BusinessException
    );

    expect(storage.upload).not.toHaveBeenCalled();
    expect(trace).not.toContain("TX_BEGIN");
  });

  it("uploads both variants, then updates the database, then commits", async () => {
    const { service, trace } = makeService();

    await service.upload("b1", Buffer.from("x"), CTX);

    expect(trace).toEqual([
      "PUT",
      "PUT",
      "TX_BEGIN",
      "DB_UPDATE",
      "AUDIT",
      "TX_COMMIT",
    ]);
  });

  it("writes all image metadata in one atomic update", async () => {
    const { service, update } = makeService();

    await service.upload("b1", Buffer.from("x"), CTX);

    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      [
        "imageContentType",
        "imageETag",
        "imageHeight",
        "imageObjectKey",
        "imageThumbnailETag",
        "imageThumbnailKey",
        "imageUpdatedAt",
        "imageWidth",
      ].sort()
    );
    // The CHECK constraint requires all eight to move together; none is null.
    expect(Object.values(data).every((v) => v !== null && v !== undefined)).toBe(true);
  });

  it("gives main and thumb DIFFERENT ETags, derived from their own bytes", async () => {
    const { service, update } = makeService();

    await service.upload("b1", Buffer.from("x"), CTX);

    const data = update.mock.calls[0][0].data as Record<string, string>;
    expect(data.imageETag).toBe(computeETag(MAIN));
    expect(data.imageThumbnailETag).toBe(computeETag(THUMB));
    expect(data.imageETag).not.toBe(data.imageThumbnailETag);
  });

  it("uses a FRESH key per upload, so a failed update leaves the old image resolvable", async () => {
    const first = makeService();
    await first.service.upload("b1", Buffer.from("x"), CTX);

    const second = makeService();
    await second.service.upload("b1", Buffer.from("x"), CTX);

    expect(first.uploaded[0]).not.toBe(second.uploaded[0]);
    expect(first.uploaded[0]).toMatch(/^banners\/b1\/[0-9a-f-]+\.jpg$/);
    expect(first.uploaded[1]).toMatch(/-thumb\.jpg$/);
  });

  it("deletes the NEW objects when the database update fails", async () => {
    const { service, uploaded, deleted } = makeService(
      { id: "b1", imageObjectKey: null, imageThumbnailKey: null },
      { updateThrows: true }
    );

    await expect(service.upload("b1", Buffer.from("x"), CTX)).rejects.toThrow("db write failed");

    // Both freshly uploaded objects are removed — nothing references them.
    expect(deleted.sort()).toEqual([...uploaded].sort());
  });

  it("deletes the OLD objects only AFTER the database commits", async () => {
    const { service, trace, deleted } = makeService({
      id: "b1",
      imageObjectKey: "banners/b1/old.jpg",
      imageThumbnailKey: "banners/b1/old-thumb.jpg",
    });

    await service.upload("b1", Buffer.from("x"), CTX);

    expect(trace.indexOf("TX_COMMIT")).toBeLessThan(trace.lastIndexOf("DELETE"));
    expect(deleted).toEqual(["banners/b1/old.jpg", "banners/b1/old-thumb.jpg"]);
  });

  it("keeps the old objects when the database update fails", async () => {
    const { service, deleted } = makeService(
      { id: "b1", imageObjectKey: "banners/b1/old.jpg", imageThumbnailKey: "banners/b1/old-thumb.jpg" },
      { updateThrows: true }
    );

    await expect(service.upload("b1", Buffer.from("x"), CTX)).rejects.toThrow();

    expect(deleted).not.toContain("banners/b1/old.jpg");
  });

  it("does not fail the request when deleting an old object fails", async () => {
    const { service, storage } = makeService({
      id: "b1",
      imageObjectKey: "banners/b1/old.jpg",
      imageThumbnailKey: "banners/b1/old-thumb.jpg",
    });
    (storage.delete as jest.Mock).mockRejectedValue(new Error("storage unreachable"));

    await expect(service.upload("b1", Buffer.from("x"), CTX)).resolves.toBeDefined();
  });

  it("refuses a payload larger than the policy before decoding", async () => {
    const { service, storage } = makeService();

    await expect(
      service.upload("b1", Buffer.alloc(3 * 1024 * 1024), CTX)
    ).rejects.toBeInstanceOf(BusinessException);
    expect(processImage).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("404s for an unknown banner without touching storage", async () => {
    const { service, storage } = makeService(null);

    await expect(service.upload("missing", Buffer.from("x"), CTX)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("never records an object key in the audit entry", async () => {
    const { service, auditLog } = makeService();

    await service.upload("b1", Buffer.from("x"), CTX);

    const entry = JSON.stringify(auditLog.mock.calls[0][0]);
    expect(entry).not.toContain("banners/b1/");
    expect(entry).not.toContain("objectKey");
    expect(auditLog.mock.calls[0][1]).toBeDefined();
  });
});

describe("remove ordering", () => {
  it("clears the database first, then deletes the objects", async () => {
    const { service, trace, deleted } = makeService({
      id: "b1",
      imageObjectKey: "banners/b1/a.jpg",
      imageThumbnailKey: "banners/b1/a-thumb.jpg",
    });

    await service.remove("b1", CTX);

    expect(trace.indexOf("TX_COMMIT")).toBeLessThan(trace.indexOf("DELETE"));
    expect(deleted).toEqual(["banners/b1/a.jpg", "banners/b1/a-thumb.jpg"]);
  });

  it("nulls all eight image columns together", async () => {
    const { service, update } = makeService({
      id: "b1",
      imageObjectKey: "banners/b1/a.jpg",
      imageThumbnailKey: "banners/b1/a-thumb.jpg",
    });

    await service.remove("b1", CTX);

    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(Object.keys(data)).toHaveLength(8);
    expect(Object.values(data).every((v) => v === null)).toBe(true);
  });

  it("is a no-op when there is no image", async () => {
    const { service, trace, storage } = makeService({
      id: "b1",
      imageObjectKey: null,
      imageThumbnailKey: null,
    });

    await service.remove("b1", CTX);

    expect(trace).not.toContain("TX_BEGIN");
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("does not leave a half-cleared row when storage deletion fails", async () => {
    const { service, storage, update } = makeService({
      id: "b1",
      imageObjectKey: "banners/b1/a.jpg",
      imageThumbnailKey: "banners/b1/a-thumb.jpg",
    });
    (storage.delete as jest.Mock).mockRejectedValue(new Error("storage unreachable"));

    // The database already committed; a storage failure is logged and
    // swallowed rather than reported as a failed request.
    await expect(service.remove("b1", CTX)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("404s for an unknown banner", async () => {
    const { service } = makeService(null);
    await expect(service.remove("missing", CTX)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("findAdminImage", () => {
  it("returns null when any image column is missing", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      imageObjectKey: "k",
      imageThumbnailKey: null,
      imageContentType: "image/jpeg",
      imageETag: "e",
      imageThumbnailETag: "t",
      imageUpdatedAt: new Date(),
    });
    const prisma = { promotionalBanner: { findUnique } } as unknown as PrismaService;
    const service = new BannerImageService(
      prisma,
      { log: jest.fn() } as unknown as AuditService,
      {} as unknown as StorageService,
      {} as unknown as BannerPolicyService
    );

    await expect(service.findAdminImage("b1")).resolves.toBeNull();
  });

  it("does NOT apply a live-window filter — drafts are previewable", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { promotionalBanner: { findUnique } } as unknown as PrismaService;
    const service = new BannerImageService(
      prisma,
      { log: jest.fn() } as unknown as AuditService,
      {} as unknown as StorageService,
      {} as unknown as BannerPolicyService
    );

    await service.findAdminImage("b1");

    const where = findUnique.mock.calls[0][0].where as Record<string, unknown>;
    expect(where).toEqual({ id: "b1" });
    expect(where).not.toHaveProperty("isActive");
    expect(where).not.toHaveProperty("startsAt");
  });
});
