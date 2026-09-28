import { Module } from "@nestjs/common";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { AdminUsersModule } from "./admin-users/admin-users.module";
import { AdminAuditModule } from "./audit/admin-audit.module";
import { AdminOutboxModule } from "./outbox/admin-outbox.module";
import { AdminDirectoryModule } from "./directory/admin-directory.module";
import { AdminDashboardModule } from "./dashboard/admin-dashboard.module";
import { AdminCompanyModule } from "./companies/admin-company.module";
import { AdminMoneyReadsModule } from "./money/admin-money-reads.module";
import { AdminSettingsModule } from "./settings/admin-settings.module";
import { AdminBrandingModule } from "./branding/admin-branding.module";
import { OperationsModule } from "./operations/operations.module";
import { IntegrationCenterModule } from "./integrations/integration-center.module";
import { AdminPoliciesModule } from "./policies/admin-policies.module";

@Module({
  imports: [
    AdminDashboardModule,
    AdminAuthModule,
    AdminSettingsModule,
    AdminPoliciesModule,
    AdminBrandingModule,
    OperationsModule,
    IntegrationCenterModule,
    AdminUsersModule,
    AdminAuditModule,
    AdminOutboxModule,
    AdminDirectoryModule,
    AdminCompanyModule,
    AdminMoneyReadsModule,
  ],
})
export class AdminModule {}
