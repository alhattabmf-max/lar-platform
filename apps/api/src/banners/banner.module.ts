import { Module } from "@nestjs/common";
import { BannerService } from "./banner.service";
import { BannerImageService } from "./banner-image.service";
import { BannerLinkService } from "./banner-link.service";
import { BannerController } from "./banner.controller";
import { ImageDeliveryService } from "../common/media/image-delivery.service";
import { BannerPolicyService } from "../settings/banner-policy.service";
import { BannerLinkAllowlistService } from "../settings/banner-link-allowlist.service";

/**
 * Owns the PUBLIC banner surface and every banner service. The admin
 * module imports this one rather than re-providing anything, so the
 * scheduling rules, the LIVE predicate and the storage orchestration
 * exist exactly once.
 */
@Module({
  controllers: [BannerController],
  providers: [
    BannerService,
    BannerImageService,
    BannerLinkService,
    BannerPolicyService,
    BannerLinkAllowlistService,
    ImageDeliveryService,
  ],
  exports: [BannerService, BannerImageService, BannerLinkService, ImageDeliveryService],
})
export class BannerModule {}
