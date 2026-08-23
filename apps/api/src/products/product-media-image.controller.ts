import { Controller, Get, Headers, NotFoundException, Param, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ProductMediaImageService } from "./product-media-image.service";
import { ImageDeliveryService } from "../common/media/image-delivery.service";
import { ImageVariantQueryDto, wantsThumbnail } from "../banners/dto/image-variant.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

/**
 * A supplier's own product image.
 *
 * A separate controller from the media WRITE routes, for the same reason the
 * opportunity image route is separate from discovery: this writes to the
 * response directly while those return JSON, and mixing the two response
 * styles in one class makes both harder to follow.
 *
 * No `CsrfGuard`. The provider exempts safe methods anyway, and every route
 * here is a GET — the same shape as the other read-only supplier controllers.
 *
 * PRIVATE. Unlike `/opportunities/:id/image`, which serves a published
 * snapshot to anyone, this serves a product that may never have been published
 * at all. The session and the supplier guard gate it, and the resolver re-runs
 * the ownership check inside its query on every request — a URL is guessable,
 * so possession of one must never be treated as permission.
 *
 * The object key appears in no request, no response body and no header: the
 * ETag is a hash of it, which is what lets a validator be returned without
 * disclosing the address it validates.
 */
@Controller("companies/me/products/:productId/media")
@UseGuards(SessionAuthGuard, RequireSupplierGuard)
export class ProductMediaImageController {
  constructor(
    private readonly images: ProductMediaImageService,
    private readonly delivery: ImageDeliveryService
  ) {}

  @Get(":mediaId/image")
  async getImage(
    @Param("productId") productId: string,
    @Param("mediaId") mediaId: string,
    @Query() query: ImageVariantQueryDto,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("if-modified-since") ifModifiedSince: string | undefined,
    @CurrentSession() session: SessionData,
    @Res() res: Response
  ): Promise<void> {
    // An unrecognised `variant` is rejected by the shared DTO before this
    // runs — a 400, never a silent fall back to `main`. Serving something
    // other than what was asked for hides a client bug.
    const target = await this.images.findOwnedTarget(
      session.companyId,
      productId,
      mediaId,
      wantsThumbnail(query) ? "thumb" : "main"
    );

    // Unknown media, media belonging to a different product, a product
    // belonging to another company, and an unservable key are ONE answer with
    // no observable difference between them.
    if (!target) throw new NotFoundException("Image not found");

    const result = await this.delivery.serve(target, { ifNoneMatch, ifModifiedSince });

    res.set(result.headers).status(result.status);
    // A 304 carries no body, per RFC 9110 — `end()` rather than `send()`.
    if (result.body) res.send(result.body);
    else res.end();
  }
}
