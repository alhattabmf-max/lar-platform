export type ShippingTierCode = "SAME_CITY" | "SAME_REGION_DIFFERENT_CITY" | "DIFFERENT_REGION";

export interface ShippingTariff {
  sameCityFeeAmount: number;
  sameRegionDifferentCityFeeAmount: number;
  differentRegionFeeAmount: number;
}

/**
 * Which shipping tier a delivery falls into — pure, no I/O.
 *
 * THE REGION IS THE BASIS; THE CITY IS AN OPTIONAL REFINEMENT. A branch
 * always has a region and may or may not name a city, because a branch
 * is now recorded against a region and the city is optional. The tiers
 * and their prices are unchanged — what changed is that a missing city
 * is an ordinary, expected state rather than an impossible one, and the
 * rule has to say what it costs.
 *
 * THE OWNER'S RULE, in three lines:
 *
 *   · the two sides name the SAME city            → SAME_CITY
 *   · same region, but the cities differ OR either
 *     side does not name one                      → SAME_REGION_DIFFERENT_CITY
 *   · different region                            → DIFFERENT_REGION
 *
 * "SAME_REGION_DIFFERENT_CITY" therefore covers three situations that
 * are priced alike: two different cities, one city named and one not,
 * and neither named. The name kept its original spelling because it is
 * a stored enum value on every historical allocation; renaming it would
 * rewrite what past orders say they were charged for.
 *
 * THE CHEAPEST TIER IS THE ONE THAT MUST BE PROVEN. Charging 50 rather
 * than 120 requires both sides to actually name a city and for those
 * cities to be the same. This function used to compare the two city ids
 * directly while the caller passed `?? ""` for a missing one, so two
 * branches with no city compared EQUAL and the delivery was billed as
 * same-city. That is the defect the explicit emptiness checks below
 * close, and it is why they are checks rather than a comment.
 *
 * A MISSING REGION IS NOT A MATCH. Both regions are guaranteed present
 * in practice — a branch's region is NOT NULL, and an opportunity's is
 * written at publish — so this only guards the unreachable. It refuses
 * to read two blanks as "the same place", which is the same mistake in
 * a different field.
 */
export function resolveShippingTier(input: {
  /** Null or empty when the branch names no city, which is allowed. */
  branchCityId: string | null;
  branchRegionId: string | null;
  /** Null or empty when the listing's branch named no city. */
  opportunityFulfillmentCityId: string | null;
  opportunityFulfillmentRegionId: string | null;
}): ShippingTierCode {
  const named = (value: string | null): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const branchCity = named(input.branchCityId);
  const listingCity = named(input.opportunityFulfillmentCityId);
  if (branchCity !== null && branchCity === listingCity) return "SAME_CITY";

  const branchRegion = named(input.branchRegionId);
  const listingRegion = named(input.opportunityFulfillmentRegionId);
  if (branchRegion !== null && branchRegion === listingRegion) {
    return "SAME_REGION_DIFFERENT_CITY";
  }

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
