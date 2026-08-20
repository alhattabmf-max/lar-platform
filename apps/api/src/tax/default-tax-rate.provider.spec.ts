import { DefaultTaxRateProvider } from "./default-tax-rate.provider";
import { TaxRateSettingsService } from "../settings/tax-rate-settings.service";

function fakeTaxRateSettings(getDefaultRate: jest.Mock) {
  return { getDefaultRate } as unknown as TaxRateSettingsService;
}

describe("DefaultTaxRateProvider", () => {
  it("returns null when no default rate is configured — never invents one", async () => {
    const provider = new DefaultTaxRateProvider(fakeTaxRateSettings(jest.fn().mockResolvedValue(null)));
    const result = await provider.getApplicableRate({ productId: "p1", taxonomyNodeId: "t1" });
    expect(result).toBeNull();
  });

  it("returns ratePercent, a version-derived ruleVersion, and the DEFAULT ruleCode when configured", async () => {
    const getDefaultRate = jest.fn().mockResolvedValue({ ratePercent: 15, version: 3 });
    const provider = new DefaultTaxRateProvider(fakeTaxRateSettings(getDefaultRate));
    const result = await provider.getApplicableRate({ productId: "p1", taxonomyNodeId: "t1" });
    expect(result).toEqual({ ratePercent: 15, ruleCode: "DEFAULT", ruleVersion: "v3" });
  });

  it("accepts productId and taxonomyNodeId per the contract, but the DEFAULT provider does not branch on them (no classification rules in Phase 6)", async () => {
    const getDefaultRate = jest.fn().mockResolvedValue({ ratePercent: 15, version: 1 });
    const provider = new DefaultTaxRateProvider(fakeTaxRateSettings(getDefaultRate));

    const resultA = await provider.getApplicableRate({ productId: "product-a", taxonomyNodeId: "food" });
    const resultB = await provider.getApplicableRate({
      productId: "product-b",
      taxonomyNodeId: "electronics",
    });

    // Same result regardless of product/category — proves the current
    // implementation is genuinely uniform, not silently rule-based.
    expect(resultA).toEqual(resultB);
    expect(resultA).toEqual({ ratePercent: 15, ruleCode: "DEFAULT", ruleVersion: "v1" });
  });
});
