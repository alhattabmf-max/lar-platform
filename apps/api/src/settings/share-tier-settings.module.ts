import { Module } from "@nestjs/common";
import { ShareTierSettingsService } from "./share-tier-settings.service";

@Module({
  providers: [ShareTierSettingsService],
  exports: [ShareTierSettingsService],
})
export class ShareTierSettingsModule {}
