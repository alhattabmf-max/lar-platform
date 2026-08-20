import { Module } from "@nestjs/common";
import { FinancialSettingsService } from "./financial-settings.service";

@Module({
  providers: [FinancialSettingsService],
  exports: [FinancialSettingsService],
})
export class FinancialSettingsModule {}
