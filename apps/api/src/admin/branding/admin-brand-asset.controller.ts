import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
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
import type { BrandAssetsAdminView } from "@platform/types";
import { BrandAssetService } from "../../branding/brand-asset.service";
import { ImageDeliveryService } from "../../common/media/image-delivery.service";
import {
  ImageVariantQueryDto,
  wantsThumbnail,
} from "../../banners/dto/image-variant.dto";
import { BrandLocaleQueryDto } from "../../branding/dto/brand-locale.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";
import { MEDIA_SIZE_HARD_CEILING_BYTES } from "../../settings/media-policy.service";

/**
 * The header logo, from the identity screen.
 *
 * FOUR ACTIONS ON ONE RESOURCE, and the language is a query parameter
 * rather than a path of its own: uploading Arabic and uploading English
 * are the same operation with a different subject, and splitting them
 * into two routes would double the surface to say one thing.
 *
 * PUBLISH AND DELETE TAKE NO LANGUAGE, deliberately. Both act on the
 * SET: a header showing one language's new logo beside the other's old
 * one is not a state anyone chose, so neither is offered per language.
 */
@Controller("admin/branding/logo")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminBrandAssetController {
  constructor(
    private readonly assets: BrandAssetService,
    private readonly delivery: ImageDeliveryService,
  ) {}

  /** The set, with no object keys — what exists and whether it is live. */
  @Get()
  list(): Promise<BrandAssetsAdminView> {
    return this.assets.listForAdmin();
  }

  /**
   * Admin preview: published or not.
   *
   * The public route serves only what is published, which is exactly
   * why this one exists — an operator has to see a replacement before
   * deciding to publish it.
   */
  @Get("image")
  async getImage(
    @Query() query: ImageVariantQueryDto & BrandLocaleQueryDto,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("if-modified-since") ifModifiedSince: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.assets.findForAdmin(query.locale);
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

  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MEDIA_SIZE_HARD_CEILING_BYTES },
    }),
  )
  upload(
    @Query() query: BrandLocaleQueryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('A file field named "file" is required');
    }
    return this.assets.upload(query.locale, file.buffer, ctxFrom(session, req));
  }

  @Post("publish")
  async publish(
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    await this.assets.publish(ctxFrom(session, req));
    return { status: "ok" };
  }

  @Delete()
  async remove(
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    await this.assets.deleteAll(ctxFrom(session, req));
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
