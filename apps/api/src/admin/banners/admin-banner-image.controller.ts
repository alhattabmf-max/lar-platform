import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { BannerImageService } from "../../banners/banner-image.service";
import { ImageDeliveryService } from "../../common/media/image-delivery.service";
import { MEDIA_SIZE_HARD_CEILING_BYTES } from "../../settings/media-policy.service";
import {
  ImageVariantQueryDto,
  wantsThumbnail,
} from "../../banners/dto/image-variant.dto";
import { BannerLocaleQueryDto } from "../../banners/dto/banner-locale.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

/**
 * Admin banner images: preview, upload, remove.
 *
 * The preview route deliberately does NOT apply the LIVE predicate. An
 * admin must be able to see a draft or a scheduled banner's image
 * before publishing it — that is the entire point of a draft. The
 * access boundary here is the admin session, not the schedule.
 *
 * It still never returns an object key: the banner id is resolved to a
 * key server-side, exactly as on the public route, and both share one
 * ImageDeliveryService so the caching and content-type behaviour cannot
 * drift between them.
 */
@Controller("admin/banners")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminBannerImageController {
  constructor(
    private readonly images: BannerImageService,
    private readonly delivery: ImageDeliveryService,
  ) {}

  @Get(":id/image")
  async getImage(
    @Param("id") id: string,
    @Query() query: ImageVariantQueryDto & BannerLocaleQueryDto,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("if-modified-since") ifModifiedSince: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const image = await this.images.findAdminImage(id, query.locale);
    // An unknown banner and a banner with no image are the same answer.
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

  @Post(":id/image")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MEDIA_SIZE_HARD_CEILING_BYTES },
    }),
  )
  upload(
    @Param("id") id: string,
    @Query() query: BannerLocaleQueryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('A file field named "file" is required');
    }
    // The language is a QUERY PARAMETER on the existing route, not a new
    // route per language: it selects which artwork this upload replaces,
    // and the work either side of it is identical.
    return this.images.upload(
      id,
      query.locale,
      file.buffer,
      ctxFrom(session, req),
    );
  }

  @Delete(":id/image")
  async remove(
    @Param("id") id: string,
    @Query() query: BannerLocaleQueryDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    await this.images.remove(id, query.locale, ctxFrom(session, req));
    return { status: "ok" };
  }
}

function ctxFrom(session: AdminSessionData, req: Request) {
  return {
    actorId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}
