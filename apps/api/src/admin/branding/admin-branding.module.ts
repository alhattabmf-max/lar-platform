import { Module } from "@nestjs/common";
import { AdminBrandingService } from "./admin-branding.service";
import { AdminBrandingController } from "./admin-branding.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [AdminSessionModule],
  controllers: [AdminBrandingController],
  providers: [AdminBrandingService],
})
export class AdminBrandingModule {}
