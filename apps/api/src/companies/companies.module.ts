import { Module } from "@nestjs/common";
import { CompaniesService } from "./companies.service";
import { CompaniesController } from "./companies.controller";
import { PolicyLimitsController } from "./policy-limits.controller";
import { MediaPolicyModule } from "../settings/media-policy.module";
import { OpportunitySettingsModule } from "../settings/opportunity-settings.module";

@Module({
  // The two settings services the policy-limits read projects from. It
  // reads them rather than re-exporting their shapes: one of them also
  // carries an internal display flag that must not leave the admin
  // surface.
  imports: [MediaPolicyModule, OpportunitySettingsModule],
  controllers: [CompaniesController, PolicyLimitsController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
