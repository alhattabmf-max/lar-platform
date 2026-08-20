import { Module } from "@nestjs/common";
import { SecuritySettingsService } from "./security-settings.service";

@Module({
  providers: [SecuritySettingsService],
  exports: [SecuritySettingsService],
})
export class SecuritySettingsModule {}
