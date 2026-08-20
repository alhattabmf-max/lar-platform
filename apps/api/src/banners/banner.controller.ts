import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { BannerItem } from "@platform/types";
import { BannerService } from "./banner.service";
import { ImageDeliveryService } from "../common/media/image-delivery.service";
import { ListPublicBannersQueryDto } from "./dto/public-banner.dto";
import { ImageVariantQueryDto, wantsThumbnail } from "./dto/image-variant.dto";

/**
 * Public banners. No session, no guards — these appear on pages nobody
 * has signed in to.
 *
 * Both routes resolve visibility through BannerService, which composes
 * the ONE shared LIVE predicate. Neither restates it, so an image can
 * never be fetchable for a banner the list refuses to show — probing
 * image URLs cannot reveal that a draft, a scheduled banner, or an
 * expired one exists.
 */
@Controller("banners")
export class BannerController {
  constructor(
    private readonly banners: BannerService,
    private readonly delivery: ImageDeliveryService
  ) {}

  @Get()
  async list(@Query() query: ListPublicBannersQueryDto): Promise<BannerItem[]> {
    const rows = await this.banners.listLive(query.placement);

    return rows.map((row) => ({
      id: row.id,
      titleAr: row.titleAr,
      titleEn: row.titleEn,
      bodyAr: row.bodyAr,
      bodyEn: row.bodyEn,
      linkUrl: row.linkUrl,
      // Routes, never object keys. Null when there is no image, so the
      // client renders its no-image state instead of a broken request.
      imageUrl: row.hasImage ? `/api/v1/banners/${row.id}/image` : null,
      thumbnailUrl: row.hasImage ? `/api/v1/banners/${row.id}/image?variant=thumb` : null,
    }));
  }

  @Get(":id/image")
  async getImage(
    @Param("id") id: string,
    @Query() query: ImageVariantQueryDto,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("if-modified-since") ifModifiedSince: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    const image = await this.banners.findLiveImage(id);
    // Not live, no image, and unknown id are ONE answer with no
    // observable difference between them.
    if (!image) throw new NotFoundException("Image not found");

    const thumb = wantsThumbnail(query);

    const result = await this.delivery.serve(
      {
        objectKey: thumb ? image.imageThumbnailKey : image.imageObjectKey,
        contentType: image.imageContentType,
        etag: thumb ? image.imageThumbnailETag : image.imageETag,
        lastModified: image.imageUpdatedAt,
      },
      { ifNoneMatch, ifModifiedSince }
    );

    res.set(result.headers).status(result.status);
    if (result.body) res.send(result.body);
    else res.end();
  }
}
