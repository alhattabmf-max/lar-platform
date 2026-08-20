import { Module } from "@nestjs/common";
import { TAX_RATE_PROVIDER } from "./tax-rate-provider.interface";
import { DefaultTaxRateProvider } from "./default-tax-rate.provider";
import { TaxRateSettingsModule } from "../settings/tax-rate-settings.module";

@Module({
  imports: [TaxRateSettingsModule],
  providers: [{ provide: TAX_RATE_PROVIDER, useClass: DefaultTaxRateProvider }],
  exports: [TAX_RATE_PROVIDER],
})
export class TaxModule {}
