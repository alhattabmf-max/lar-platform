import { Module } from "@nestjs/common";
import { AdminBannerController } from "./admin-banner.controller";
import { AdminBannerImageController } from "./admin-banner-image.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";
import { BannerModule } from "../../banners/banner.module";

/**
 * Controllers only. Every service comes from BannerModule, so the admin
 * surface cannot acquire a second copy of the scheduling or storage
 * rules.
 */
@Module({
  imports: [AdminSessionModule, BannerModule],
  controllers: [AdminBannerController, AdminBannerImageController],
})
export class AdminBannerModule {}
