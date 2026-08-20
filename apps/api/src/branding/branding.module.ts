import { Module } from "@nestjs/common";
import { BrandingService } from "./branding.service";
import { BrandingController } from "./branding.controller";
import { BrandThemeService } from "./brand-theme.service";

@Module({
  controllers: [BrandingController],
  providers: [BrandingService, BrandThemeService],
  // BrandThemeService is exported so the ADMIN branding module can drive
  // draft/publish/reset without duplicating the storage rules. The
  // public controller stays in this module and exposes the active theme
  // only.
  exports: [BrandingService, BrandThemeService],
})
export class BrandingModule {}
