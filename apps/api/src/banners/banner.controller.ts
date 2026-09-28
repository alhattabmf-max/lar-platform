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
import { BannerLocaleQueryDto } from "./dto/banner-locale.dto";

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
    private readonly delivery: ImageDeliveryService,
  ) {}

  @Get()
  async list(@Query() query: ListPublicBannersQueryDto): Promise<BannerItem[]> {
    const rows = await this.banners.listLive(query.placement, query.locale);
    const locale = encodeURIComponent(query.locale);

    return rows.map((row) => ({
      id: row.id,
      linkUrl: row.linkUrl,
      // Routes, never object keys. The locale travels in the URL so the
      // image request resolves to the same language the list was built
      // for — a client cannot end up asking for the other one.
      //
      // Never null: the list only returns banners whose artwork for this
      // language exists, so there is no no-image case to represent.
      imageUrl: `/api/v1/banners/${row.id}/image?locale=${locale}`,
      thumbnailUrl: `/api/v1/banners/${row.id}/image?locale=${locale}&variant=thumb`,
    }));
  }

  @Get(":id/image")
  async getImage(
    @Param("id") id: string,
    @Query() query: ImageVariantQueryDto & BannerLocaleQueryDto,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("if-modified-since") ifModifiedSince: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const image = await this.banners.findLiveImage(id, query.locale);
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
      { ifNoneMatch, ifModifiedSince },
    );

    res.set(result.headers).status(result.status);
    if (result.body) res.send(result.body);
    else res.end();
  }
}
