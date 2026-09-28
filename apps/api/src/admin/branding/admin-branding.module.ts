import { Module } from "@nestjs/common";
import { AdminBrandAssetController } from "./admin-brand-asset.controller";
import { AdminBrandingService } from "./admin-branding.service";
import { AdminBrandingController } from "./admin-branding.controller";
import { AdminBrandThemeController } from "./admin-brand-theme.controller";
import { AdminFooterController } from "./admin-footer.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";
import { BrandingModule } from "../../branding/branding.module";

@Module({
  imports: [AdminSessionModule, BrandingModule],
  controllers: [
    AdminBrandingController,
    AdminBrandThemeController,
    AdminBrandAssetController,
    AdminFooterController,
  ],
  providers: [AdminBrandingService],
})
export class AdminBrandingModule {}
