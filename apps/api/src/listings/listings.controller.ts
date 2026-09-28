import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { ListingsService } from "./listings.service";
import { CreateListingDto } from "./dto/create-listing.dto";
import { MEDIA_SIZE_HARD_CEILING_BYTES } from "../settings/media-policy.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
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

/**
 * ONE ROUTE FOR WHAT USED TO BE FOUR.
 *
 * A supplier used to create a product, upload its image, submit it for
 * auto-approval, then build an "opportunity" on top and publish that —
 * four calls, two vocabularies, and a concept nobody outside the
 * codebase had a use for. This is the same work behind one button.
 *
 * MULTIPART, so the image is part of the submission rather than a
 * second trip that can succeed while the rest fails. `FileInterceptor`
 * caps the upload at the same hard ceiling every other image route
 * uses; the media policy's own, lower limit is applied afterwards by
 * the service that owns it.
 *
 * The old product and opportunity routes are untouched. They are what
 * the platform's existing suppliers, tests, and the admin surface
 * already speak, and this adds a seam rather than replacing plumbing.
 */
@Controller("companies/me/listings")
@UseGuards(SessionAuthGuard, CsrfGuard, RequireSupplierGuard)
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post()
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: MEDIA_SIZE_HARD_CEILING_BYTES } }))
  create(
    @UploadedFile() image: Express.Multer.File | undefined,
    @Body() dto: CreateListingDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    // THE IMAGE IS NOT OPTIONAL. Auto-approval refuses a product
    // without a main image, so accepting the form without one would
    // only move the rejection later and lose everything typed.
    if (!image) {
      throw new BadRequestException('An image field named "image" is required');
    }
    return this.listings.create(dto, image.buffer, ctxFrom(session, req));
  }

  /**
   * REMOVING A PRODUCT. What happens depends on whether anybody bought
   * it — the service decides, and says which it did.
   */
  @Delete(":id")
  remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.listings.remove(id, ctxFrom(session, req));
  }

  /** The supplier cleared whatever blocked publication. Try again. */
  @Post(":id/publish")
  publish(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.listings.resume(id, ctxFrom(session, req));
  }
}
