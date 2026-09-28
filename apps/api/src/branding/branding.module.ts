import { Module } from "@nestjs/common";
import { BrandingService } from "./branding.service";
import { BrandingController } from "./branding.controller";
import { BrandThemeService } from "./brand-theme.service";
import { BrandAssetService } from "./brand-asset.service";
import { FooterService } from "./footer.service";
import { ImageDeliveryService } from "../common/media/image-delivery.service";
import { StorageModule } from "../storage/storage.module";
import { PoliciesModule } from "../policies/policies.module";

@Module({
  // Provides StorageService, which BrandAssetService injects. Without
  // it Nest cannot construct the service and the application fails to
  // boot.
  // PoliciesModule provides PoliciesService, which FooterService asks
  // which policy documents are actually published — an enabled Terms
  // link must not render when no Terms document exists.
  imports: [StorageModule, PoliciesModule],
  controllers: [BrandingController],
  providers: [
    BrandingService,
    BrandThemeService,
    BrandAssetService,
    FooterService,
    ImageDeliveryService,
  ],
  // BrandThemeService is exported so the ADMIN branding module can drive
  // draft/publish/reset without duplicating the storage rules. The
  // public controller stays in this module and exposes the active theme
  // only.
  exports: [
    BrandingService,
    BrandThemeService,
    BrandAssetService,
    FooterService,
    ImageDeliveryService,
  ],
})
export class BrandingModule {}
