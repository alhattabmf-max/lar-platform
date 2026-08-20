import { Injectable } from "@nestjs/common";
import { TaxRateSettingsService } from "../settings/tax-rate-settings.service";
import type { TaxRateContext, TaxRateProvider, TaxRateResult } from "./tax-rate-provider.interface";

const DEFAULT_RULE_CODE = "DEFAULT";

@Injectable()
export class DefaultTaxRateProvider implements TaxRateProvider {
  constructor(private readonly taxRateSettings: TaxRateSettingsService) {}

  async getApplicableRate(_context: TaxRateContext): Promise<TaxRateResult | null> {
    const config = await this.taxRateSettings.getDefaultRate();
    if (!config) return null;

    return {
      ratePercent: config.ratePercent,
      ruleCode: DEFAULT_RULE_CODE,
      ruleVersion: `v${config.version}`,
    };
  }
}
