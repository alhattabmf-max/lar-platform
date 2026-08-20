import { Module } from "@nestjs/common";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { AdminSettingsModule } from "./settings/admin-settings.module";
import { AdminBrandingModule } from "./branding/admin-branding.module";
import { OperationsModule } from "./operations/operations.module";
import { IntegrationCenterModule } from "./integrations/integration-center.module";

@Module({
  imports: [
    AdminAuthModule,
    AdminSettingsModule,
    AdminBrandingModule,
    OperationsModule,
    IntegrationCenterModule,
  ],
})
export class AdminModule {}
