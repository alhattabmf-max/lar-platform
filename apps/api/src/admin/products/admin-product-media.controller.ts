import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { ProductMediaService } from "../../products/product-media.service";
import { ReorderMediaDto } from "../../products/dto/reorder-media.dto";
import { MEDIA_SIZE_HARD_CEILING_BYTES } from "../../settings/media-policy.service";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

function ctxFrom(session: AdminSessionData, req: Request) {
  return {
    adminUserId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

/**
 * A PRODUCT'S PICTURES, CHANGED FROM THE CONSOLE.
 *
 * «حتى الصورة اجعلها قابلة للتعديل، لأني أضغط عليها ولا يعطيني تعديل.»
 *
 * THE SAME FOUR OPERATIONS THE SUPPLIER HAS, through the SAME service —
 * the same processing, the same storage keys, the same orphan cleanup,
 * the same re-approval when an approved product's pictures change. What
 * differs is two things, and both live in that service's actor
 * descriptor rather than in a second copy of the logic here:
 *
 *   - the product is resolved without an ownership clause, because an
 *     administrator has no company to match against. The gate is the
 *     admin session guard on this class;
 *   - the supplier's live-offer refusal does not apply, for the same
 *     reason it does not apply to the fields — support exists for the
 *     cases the seller cannot fix, and a published offer renders from
 *     its own frozen snapshot either way.
 *
 * EVERY WRITE IS RECORDED under a name that says who did it:
 * `PRODUCT_MEDIA_REMOVED_BY_ADMIN` and its three siblings.
 *
 * SEPARATE FROM THE IMAGE ROUTE next door, which writes bytes to the
 * response while these return JSON.
 */
@Controller("admin/products/:productId/media")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminProductMediaController {
  constructor(private readonly media: ProductMediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MEDIA_SIZE_HARD_CEILING_BYTES } }))
  upload(
    @Param("productId") productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    if (!file) {
      throw new BadRequestException('A file field named "file" is required');
    }
    return this.media.uploadAsAdmin(productId, file.buffer, ctxFrom(session, req));
  }

  @Delete(":mediaId")
  remove(
    @Param("productId") productId: string,
    @Param("mediaId") mediaId: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.media.removeAsAdmin(productId, mediaId, ctxFrom(session, req));
  }

  @Post(":mediaId/set-main")
  setMain(
    @Param("productId") productId: string,
    @Param("mediaId") mediaId: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.media.setMainAsAdmin(productId, mediaId, ctxFrom(session, req));
  }

  @Post("reorder")
  reorder(
    @Param("productId") productId: string,
    @Body() dto: ReorderMediaDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.media.reorderAsAdmin(productId, dto.mediaIds, ctxFrom(session, req));
  }
}
