import { Module } from "@nestjs/common";
import { BannerService } from "./banner.service";
import { BannerImageService } from "./banner-image.service";
import { BannerLinkService } from "./banner-link.service";
import { BannerController } from "./banner.controller";
import { ImageDeliveryService } from "../common/media/image-delivery.service";
import { BannerPolicyService } from "../settings/banner-policy.service";
import { BannerLinkAllowlistService } from "../settings/banner-link-allowlist.service";
import { StorageModule } from "../storage/storage.module";

/**
 * Owns the PUBLIC banner surface and every banner service. The admin
 * module imports this one rather than re-providing anything, so the
 * scheduling rules, the LIVE predicate and the storage orchestration
 * exist exactly once.
 */
@Module({
  // Provides StorageService, which the image services here inject.
  // Without it Nest cannot construct them and the application fails to
  // boot.
  imports: [StorageModule],
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
