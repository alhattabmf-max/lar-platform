import { Controller, Get, Headers, NotFoundException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { OpportunityImageService } from "./opportunity-image.service";
import { ImageDeliveryService } from "../common/media/image-delivery.service";
import { wantsThumbnail } from "../banners/dto/image-variant.dto";
import { OpportunityImageQueryDto } from "./dto/opportunity-image-query.dto";

/**
 * Public opportunity image.
 *
 * Deliberately a separate controller from the discovery routes: it
 * writes to the response directly, while those return JSON, and mixing
 * the two response styles in one class makes both harder to follow.
 *
 * Uses the SAME `ImageVariantQueryDto` and `ImageDeliveryService` as the
 * banner routes, so an unknown variant is a 400 here too and the
 * caching semantics cannot drift between the two surfaces.
 *
 * The object key never appears in a request or a response — the
 * opportunity id resolves to one server-side.
 */
@Controller("opportunities")
export class OpportunityImageController {
  constructor(
    private readonly images: OpportunityImageService,
    private readonly delivery: ImageDeliveryService
  ) {}

  @Get(":id/image")
  async getImage(
    @Param("id") id: string,
    @Query() query: OpportunityImageQueryDto,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("if-modified-since") ifModifiedSince: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    // WHICH PHOTOGRAPH — validated by the DTO, not read around it. A
    // malformed index is a 400 there, the same as a malformed variant;
    // omitted, it is the main image.
    const target = await this.images.findPublicTarget(
      id,
      wantsThumbnail(query) ? "thumb" : "main",
      query.index
    );

    // Unknown id, not publicly visible, a legacy snapshot with no
    // media, and an unservable key are ONE answer with no observable
    // difference between them.
    if (!target) throw new NotFoundException("Image not found");

    const result = await this.delivery.serve(target, { ifNoneMatch, ifModifiedSince });

    res.set(result.headers).status(result.status);
    if (result.body) res.send(result.body);
    else res.end();
  }
}
