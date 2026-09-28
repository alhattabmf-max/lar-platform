import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { BrandingPublic, FooterPublic } from "@platform/types";
import { BrandingService } from "./branding.service";
import { BrandAssetService } from "./brand-asset.service";
import { FooterService } from "./footer.service";
import { ImageDeliveryService } from "../common/media/image-delivery.service";
import {
  ImageVariantQueryDto,
  wantsThumbnail,
} from "../banners/dto/image-variant.dto";
import { BrandLocaleQueryDto } from "./dto/brand-locale.dto";

/**
 * The public identity: names, colours, and the header logo.
 *
 * Unauthenticated by design — every visitor needs this before they have
 * a session. The admin counterpart lives elsewhere: admin-authenticated,
 * CSRF-guarded, and returning the FULL row including fields that never
 * appear here.
 *
 * No CSRF guard is needed: these are GETs, and the CSRF provider exempts
 * safe methods by design.
 */
@Controller("branding")
export class BrandingController {
  constructor(
    private readonly branding: BrandingService,
    private readonly assets: BrandAssetService,
    private readonly delivery: ImageDeliveryService,
    private readonly footerService: FooterService,
  ) {}

  @Get()
  get(@Query() query: BrandLocaleQueryDto): Promise<BrandingPublic> {
    return this.branding.getPublic(query.locale);
  }

  /**
   * The footer, as configured.
   *
   * ITS OWN ROUTE, deliberately not a field on `GET /branding`. That
   * response is pinned by an exact-key test so nothing can slip into
   * it, and the footer answers a different question from the brand's
   * identity: what this platform links to, not what it is called.
   *
   * Unauthenticated like the rest of this controller — the footer is on
   * every page including the sign-in screen.
   */
  @Get("footer")
  footer(@Query() query: BrandLocaleQueryDto): Promise<FooterPublic> {
    return this.footerService.getPublic(query.locale);
  }

  /**
   * The header logo bytes, read-only and cacheable.
   *
   * PUBLISHED ONLY. An unpublished logo is invisible here, which is
   * what makes preparing a replacement safe — it can be uploaded and
   * looked at in the admin screen without any visitor seeing it. An
   * unpublished logo and a language with none are one 404 with no
   * observable difference, so probing this route reveals nothing about
   * work in progress.
   *
   * `ImageDeliveryService` supplies the ETag and cache headers and
   * answers a conditional request with 304, exactly as it does for
   * banners and product media — one delivery path, not three.
   */
  @Get("logo")
  async getLogo(
    @Query() query: ImageVariantQueryDto & BrandLocaleQueryDto,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("if-modified-since") ifModifiedSince: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.assets.findPublished(query.locale);
    if (!asset) throw new NotFoundException("Logo not found");

    const thumb = wantsThumbnail(query);

    const result = await this.delivery.serve(
      {
        objectKey: thumb ? asset.thumbnailKey : asset.objectKey,
        contentType: asset.contentType,
        etag: thumb ? asset.thumbnailETag : asset.etag,
        lastModified: asset.updatedAt,
      },
      { ifNoneMatch, ifModifiedSince },
    );

    res.set(result.headers).status(result.status);
    if (result.body) res.send(result.body);
    else res.end();
  }
}
