import { Controller, Get, Headers, NotFoundException, Param, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ProductMediaImageService } from "../../products/product-media-image.service";
import { ImageDeliveryService } from "../../common/media/image-delivery.service";
import { ImageVariantQueryDto, wantsThumbnail } from "../../banners/dto/image-variant.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";

/**
 * A product's images, for the console.
 *
 * A SECOND DOOR TO THE SAME BYTES, and it exists because the first one
 * cannot be walked through by an administrator: the supplier's route is
 * `companies/me/products/...`, where «me» is resolved from the SESSION'S
 * company. An admin session carries no company, so that route answers
 * 404 for every image on the platform.
 *
 * THE BOUNDARY MOVES, IT DOES NOT DISAPPEAR. There the gate is
 * ownership; here it is the admin session guard on this class. The
 * resolver still binds the media to the product in its own query, so
 * one product's address cannot serve another product's picture.
 *
 * NO PUBLICATION TEST, deliberately — the same choice the admin banner
 * preview makes. A product may be a DRAFT that no buyer can reach, and
 * looking at it before deciding whether to suspend it is the entire
 * point of the screen this serves.
 *
 * A separate controller from the JSON routes because it writes to the
 * response itself; mixing the two response styles in one class makes
 * both harder to follow.
 */
@Controller("admin/products/:productId/media")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminProductImageController {
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
    @Res() res: Response
  ): Promise<void> {
    // An unrecognised `variant` is refused by the shared DTO before this
    // runs — a 400, never a silent fall back to `main`.
    const target = await this.images.findAnyTarget(
      productId,
      mediaId,
      wantsThumbnail(query) ? "thumb" : "main"
    );
    if (!target) throw new NotFoundException("Image not found");

    const result = await this.delivery.serve(target, { ifNoneMatch, ifModifiedSince });

    res.set(result.headers).status(result.status);
    // A 304 carries no body, per RFC 9110.
    if (result.body) res.send(result.body);
    else res.end();
  }
}
