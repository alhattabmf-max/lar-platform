import {
  selectTier,
  computeShareQuantity,
  suggestCompatibleQuantities,
  validateShareTiers,
  DEFAULT_SHARE_TIERS,
  type ShareTierPolicy,
} from "./share-tier";

const POLICY: ShareTierPolicy = { tiers: DEFAULT_SHARE_TIERS };

describe("selectTier", () => {
  it("selects tier 0 (10%) at and below the first boundary", () => {
    expect(selectTier(POLICY, 1).tierIndex).toBe(0);
    expect(selectTier(POLICY, 50_000).tierIndex).toBe(0);
  });

  it("selects tier 1 (5%) just above the first boundary and at the second", () => {
    expect(selectTier(POLICY, 50_000.01).tierIndex).toBe(1);
    expect(selectTier(POLICY, 200_000).tierIndex).toBe(1);
  });

  it("selects tier 2 (2.5%, open-ended) above the second boundary, with no upper limit", () => {
    expect(selectTier(POLICY, 200_000.01).tierIndex).toBe(2);
    expect(selectTier(POLICY, 999_999_999).tierIndex).toBe(2);
  });
});

describe("computeShareQuantity", () => {
  it("returns the exact integer share for a compatible quantity", () => {
    expect(computeShareQuantity(100, 1000)).toBe(10);
    expect(computeShareQuantity(4000, 250)).toBe(100);
    expect(computeShareQuantity(20, 500)).toBe(1);
  });

  it("returns null for an incompatible (non-evenly-divisible) quantity", () => {
    expect(computeShareQuantity(7, 1000)).toBeNull();
    expect(computeShareQuantity(3, 250)).toBeNull();
  });
});

describe("suggestCompatibleQuantities — O(numberOfTiers), full re-evaluation of every candidate", () => {
  it("suggests the nearest valid multiples within the same tier for a mid-tier request", () => {
    const result = suggestCompatibleQuantities(POLICY, 10, 23, 1_000_000);
    expect(result.below).toBe(20);
    expect(result.above).toBe(30);
  });

  it("suggests candidates that may cross a tier boundary, each fully re-validated", () => {
    const result = suggestCompatibleQuantities(POLICY, 500, 101, 1_000_000);
    expect(result.below).not.toBeNull();
    expect(result.above).not.toBeNull();
    if (result.below !== null) {
      const totalBelow = result.below * 500;
      const tierBelow = selectTier(POLICY, totalBelow).tier;
      expect(computeShareQuantity(result.below, tierBelow.shareBasisPoints)).not.toBeNull();
    }
    if (result.above !== null) {
      const totalAbove = result.above * 500;
      const tierAbove = selectTier(POLICY, totalAbove).tier;
      expect(computeShareQuantity(result.above, tierAbove.shareBasisPoints)).not.toBeNull();
    }
  });

  it("returns null in a direction with no valid candidate within bounds", () => {
    const result = suggestCompatibleQuantities(POLICY, 10, 1, 5);
    expect(result.below).toBeNull();
  });
});

describe("validateShareTiers — mirrors the DB-level validate_share_tiers() exactly", () => {
  it("accepts the documented default policy", () => {
    expect(validateShareTiers(DEFAULT_SHARE_TIERS)).toBeNull();
  });

  it("rejects an empty array", () => {
    expect(validateShareTiers([])).toMatch(/non-empty/);
  });

  it("rejects a basis-points value that does not evenly divide 10000", () => {
    expect(validateShareTiers([{ maxTotalValueInclTax: null, shareBasisPoints: 3000 }])).toMatch(/evenly divide/);
  });

  it("rejects a non-last tier with a null bound", () => {
    expect(
      validateShareTiers([
        { maxTotalValueInclTax: null, shareBasisPoints: 1000 },
        { maxTotalValueInclTax: null, shareBasisPoints: 500 },
      ])
    ).toMatch(/last tier/);
  });

  it("rejects a last tier that is NOT null (must be open-ended)", () => {
    expect(validateShareTiers([{ maxTotalValueInclTax: 50_000, shareBasisPoints: 1000 }])).toMatch(/open-ended/);
  });

  it("rejects non-ascending or duplicate bounds", () => {
    expect(
      validateShareTiers([
        { maxTotalValueInclTax: 50_000, shareBasisPoints: 1000 },
        { maxTotalValueInclTax: 50_000, shareBasisPoints: 500 },
        { maxTotalValueInclTax: null, shareBasisPoints: 250 },
      ])
    ).toMatch(/ascending/);

    expect(
      validateShareTiers([
        { maxTotalValueInclTax: 200_000, shareBasisPoints: 1000 },
        { maxTotalValueInclTax: 50_000, shareBasisPoints: 500 },
        { maxTotalValueInclTax: null, shareBasisPoints: 250 },
      ])
    ).toMatch(/ascending/);
  });

  it("rejects a non-positive bound", () => {
    expect(
      validateShareTiers([
        { maxTotalValueInclTax: 0, shareBasisPoints: 1000 },
        { maxTotalValueInclTax: null, shareBasisPoints: 250 },
      ])
    ).toMatch(/positive/);
  });
});
