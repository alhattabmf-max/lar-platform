import { NotFoundException } from "@nestjs/common";
import type { Response } from "express";
import { BannerController } from "./banner.controller";
import { AdminBannerImageController } from "../admin/banners/admin-banner-image.controller";
import { ImageVariant } from "./dto/image-variant.dto";
import type { BannerService } from "./banner.service";
import type { BannerImageService } from "./banner-image.service";
import type { ImageDeliveryService, ImageTarget } from "../common/media/image-delivery.service";

/**
 * Variant selection on both image routes.
 *
 * The controllers are thin, so the only decision they make is which of
 * the two stored variants to hand to ImageDeliveryService — and getting
 * that wrong would serve a thumbnail's bytes under the main image's
 * ETag, which caches would then treat as authoritative. Worth pinning
 * without an HTTP layer.
 */

const IMAGE = {
  id: "b1",
  imageObjectKey: "banners/b1/main.jpg",
  imageThumbnailKey: "banners/b1/thumb.jpg",
  imageContentType: "image/jpeg",
  imageETag: "etag-main",
  imageThumbnailETag: "etag-thumb",
  imageUpdatedAt: new Date("2026-08-20T10:00:00.000Z"),
};

interface FakeResponse {
  set: jest.Mock;
  status: jest.Mock;
  send: jest.Mock;
  end: jest.Mock;
}

function makeResponse(): Response & FakeResponse {
  const res: FakeResponse = {
    set: jest.fn(() => res),
    status: jest.fn(() => res),
    send: jest.fn(() => res),
    end: jest.fn(() => res),
  };
  return res as unknown as Response & FakeResponse;
}

function makeDelivery() {
  const targets: ImageTarget[] = [];
  const serve = jest.fn(
    async (target: ImageTarget, _conditional?: { ifNoneMatch?: string; ifModifiedSince?: string }) => {
      targets.push(target);
      return {
        status: 200 as const,
        headers: { ETag: `"${target.etag}"` },
        body: Buffer.from("x"),
      };
    }
  );
  return { delivery: { serve } as unknown as ImageDeliveryService, targets, serve };
}

describe("public banner image route", () => {
  function make(image: typeof IMAGE | null = IMAGE) {
    const banners = { findLiveImage: jest.fn().mockResolvedValue(image) } as unknown as BannerService;
    const { delivery, targets, serve } = makeDelivery();
    return { controller: new BannerController(banners, delivery), targets, serve, banners };
  }

  it("serves the MAIN variant by default", async () => {
    const { controller, targets } = make();

    await controller.getImage("b1", {}, undefined, undefined, makeResponse());

    expect(targets[0].objectKey).toBe(IMAGE.imageObjectKey);
    expect(targets[0].etag).toBe("etag-main");
  });

  it("serves the THUMB variant when asked", async () => {
    const { controller, targets } = make();

    await controller.getImage("b1", { variant: ImageVariant.thumb }, undefined, undefined, makeResponse());

    expect(targets[0].objectKey).toBe(IMAGE.imageThumbnailKey);
    expect(targets[0].etag).toBe("etag-thumb");
  });

  it("404s when the banner is not live or has no image", async () => {
    const { controller } = make(null);

    await expect(
      controller.getImage("b1", {}, undefined, undefined, makeResponse())
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("resolves visibility through the LIVE lookup, never a raw find", async () => {
    const { controller, banners } = make();

    await controller.getImage("b1", {}, undefined, undefined, makeResponse());

    expect(banners.findLiveImage).toHaveBeenCalledWith("b1");
  });

  it("forwards both conditional headers to the delivery service", async () => {
    const { controller, serve } = make();

    await controller.getImage("b1", {}, '"abc"', "Wed, 20 Aug 2026 10:00:00 GMT", makeResponse());

    expect(serve.mock.calls[0][1]).toEqual({
      ifNoneMatch: '"abc"',
      ifModifiedSince: "Wed, 20 Aug 2026 10:00:00 GMT",
    });
  });

  it("sends no body on a 304", async () => {
    const banners = { findLiveImage: jest.fn().mockResolvedValue(IMAGE) } as unknown as BannerService;
    const delivery = {
      serve: jest.fn().mockResolvedValue({ status: 304, headers: { ETag: '"x"' }, body: null }),
    } as unknown as ImageDeliveryService;
    const res = makeResponse();

    await new BannerController(banners, delivery).getImage("b1", {}, '"x"', undefined, res);

    expect(res.status).toHaveBeenCalledWith(304);
    expect(res.send).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });
});

describe("admin banner image route", () => {
  function make(image: typeof IMAGE | null = IMAGE) {
    const images = {
      findAdminImage: jest.fn().mockResolvedValue(image),
    } as unknown as BannerImageService;
    const { delivery, targets } = makeDelivery();
    return {
      controller: new AdminBannerImageController(images, delivery),
      targets,
      images,
    };
  }

  it("serves MAIN by default and THUMB on request", async () => {
    const { controller, targets } = make();

    await controller.getImage("b1", {}, undefined, undefined, makeResponse());
    await controller.getImage(
      "b1",
      { variant: ImageVariant.thumb },
      undefined,
      undefined,
      makeResponse()
    );

    expect(targets[0].objectKey).toBe(IMAGE.imageObjectKey);
    expect(targets[1].objectKey).toBe(IMAGE.imageThumbnailKey);
    expect(targets[0].etag).not.toBe(targets[1].etag);
  });

  it("uses the admin lookup, which applies NO live-window filter", async () => {
    const { controller, images } = make();

    await controller.getImage("b1", {}, undefined, undefined, makeResponse());

    // A draft or scheduled banner must be previewable; the admin
    // session is the access boundary, not the schedule.
    expect(images.findAdminImage).toHaveBeenCalledWith("b1");
  });

  it("404s for a banner with no image", async () => {
    const { controller } = make(null);

    await expect(
      controller.getImage("b1", {}, undefined, undefined, makeResponse())
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("never leaks an object key through the response headers", async () => {
    const { controller } = make();
    const res = makeResponse();

    await controller.getImage("b1", {}, undefined, undefined, res);

    expect(JSON.stringify(res.set.mock.calls)).not.toContain("banners/b1/");
  });
});
