export type ShippingTierCode = "SAME_CITY" | "SAME_REGION_DIFFERENT_CITY" | "DIFFERENT_REGION";

export interface ShippingTariff {
  sameCityFeeAmount: number;
  sameRegionDifferentCityFeeAmount: number;
  differentRegionFeeAmount: number;
}

/**
 * Pure tier resolution — no I/O. City match wins over region match
 * (a branch that IS the fulfillment city is necessarily also in the
 * fulfillment region, so checking city first is correct and sufficient).
 */
export function resolveShippingTier(input: {
  branchCityId: string;
  branchRegionId: string;
  opportunityFulfillmentCityId: string;
  opportunityFulfillmentRegionId: string;
}): ShippingTierCode {
  if (input.branchCityId === input.opportunityFulfillmentCityId) return "SAME_CITY";
  if (input.branchRegionId === input.opportunityFulfillmentRegionId) return "SAME_REGION_DIFFERENT_CITY";
  return "DIFFERENT_REGION";
}

export function feeForTier(tariff: ShippingTariff, tier: ShippingTierCode): number {
  switch (tier) {
    case "SAME_CITY":
      return tariff.sameCityFeeAmount;
    case "SAME_REGION_DIFFERENT_CITY":
      return tariff.sameRegionDifferentCityFeeAmount;
    case "DIFFERENT_REGION":
      return tariff.differentRegionFeeAmount;
  }
}
