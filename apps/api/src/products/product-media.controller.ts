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
import { ProductMediaService } from "./product-media.service";
import { ReorderMediaDto } from "./dto/reorder-media.dto";
import { MEDIA_SIZE_HARD_CEILING_BYTES } from "../settings/media-policy.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";

function ctxFrom(session: SessionData, req: Request) {
  return {
    userId: session.userId,
    companyId: session.companyId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("companies/me/products/:productId/media")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ProductMediaController {
  constructor(private readonly media: ProductMediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MEDIA_SIZE_HARD_CEILING_BYTES } }))
  upload(
    @Param("productId") productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    if (!file) {
      throw new BadRequestException("A file field named \"file\" is required");
    }
    return this.media.upload(productId, file.buffer, ctxFrom(session, req));
  }

  @Delete(":mediaId")
  remove(
    @Param("productId") productId: string,
    @Param("mediaId") mediaId: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.media.remove(productId, mediaId, ctxFrom(session, req));
  }

  @Post(":mediaId/set-main")
  setMain(
    @Param("productId") productId: string,
    @Param("mediaId") mediaId: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.media.setMain(productId, mediaId, ctxFrom(session, req));
  }

  @Post("reorder")
  reorder(
    @Param("productId") productId: string,
    @Body() dto: ReorderMediaDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.media.reorder(productId, dto.mediaIds, ctxFrom(session, req));
  }
}
