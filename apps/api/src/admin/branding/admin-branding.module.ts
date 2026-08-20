import { Module } from "@nestjs/common";
import { AdminBrandingService } from "./admin-branding.service";
import { AdminBrandingController } from "./admin-branding.controller";
import { AdminBrandThemeController } from "./admin-brand-theme.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";
import { BrandingModule } from "../../branding/branding.module";

@Module({
  imports: [AdminSessionModule, BrandingModule],
  controllers: [AdminBrandingController, AdminBrandThemeController],
  providers: [AdminBrandingService],
})
export class AdminBrandingModule {}
