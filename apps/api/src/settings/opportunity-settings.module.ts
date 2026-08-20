import { Module } from "@nestjs/common";
import { OpportunitySettingsService } from "./opportunity-settings.service";

@Module({
  providers: [OpportunitySettingsService],
  exports: [OpportunitySettingsService],
})
export class OpportunitySettingsModule {}
