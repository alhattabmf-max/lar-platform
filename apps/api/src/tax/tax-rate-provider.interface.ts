export interface TaxRateContext {
  productId: string;
  taxonomyNodeId: string;
}

export interface TaxRateResult {
  ratePercent: number;
  ruleCode: string;
  ruleVersion: string;
}

export const TAX_RATE_PROVIDER = Symbol("TAX_RATE_PROVIDER");

export interface TaxRateProvider {
  /**
   * Returns null when no applicable rate can currently be determined
   * (e.g. the admin hasn't configured one yet) — callers MUST treat
   * null as "cannot publish," never substitute a rate of their own.
   */
  getApplicableRate(context: TaxRateContext): Promise<TaxRateResult | null>;
}
