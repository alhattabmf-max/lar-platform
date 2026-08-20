import { Module } from "@nestjs/common";
import { TaxRateSettingsService } from "./tax-rate-settings.service";

@Module({
  providers: [TaxRateSettingsService],
  exports: [TaxRateSettingsService],
})
export class TaxRateSettingsModule {}
