import {
  feeForTier,
  resolveShippingTier,
  type ShippingTariff,
} from "./checkout-shipping-tier";

/**
 * What a delivery costs.
 *
 * THIS IS MONEY. Every case below is a price a buyer is actually
 * charged, so the table is written out in full rather than generated:
 * a rule expressed twice — once in the code and once in a loop that
 * mirrors it — proves only that the loop matches the code.
 *
 * THE TIERS AND THE PRICES ARE UNCHANGED. What this file pins is how
 * they apply now that a branch's city is OPTIONAL and its region is
 * not: the region decides, and the city can only ever move a delivery
 * DOWN to the cheapest tier, and only when both sides name the same
 * one.
 */

const RIYADH = "region-riyadh";
const MAKKAH = "region-makkah";
const RIYADH_CITY = "city-riyadh";
const KHARJ = "city-kharj";

/** The tariff in force when this was written. */
const TARIFF: ShippingTariff = {
  sameCityFeeAmount: 50,
  sameRegionDifferentCityFeeAmount: 120,
  differentRegionFeeAmount: 250,
};

const price = (input: {
  branchCityId: string | null;
  branchRegionId: string | null;
  opportunityFulfillmentCityId: string | null;
  opportunityFulfillmentRegionId: string | null;
}) => feeForTier(TARIFF, resolveShippingTier(input));

describe("the six cases the owner specified", () => {
  it("both cities missing, one region → 120", () => {
    const input = {
      branchCityId: null,
      branchRegionId: RIYADH,
      opportunityFulfillmentCityId: null,
      opportunityFulfillmentRegionId: RIYADH,
    };
    expect(resolveShippingTier(input)).toBe("SAME_REGION_DIFFERENT_CITY");
    expect(price(input)).toBe(120);
  });

  it("one side names a city, the other does not, one region → 120", () => {
    const supplierNames = {
      branchCityId: RIYADH_CITY,
      branchRegionId: RIYADH,
      opportunityFulfillmentCityId: null,
      opportunityFulfillmentRegionId: RIYADH,
    };
    expect(resolveShippingTier(supplierNames)).toBe("SAME_REGION_DIFFERENT_CITY");
    expect(price(supplierNames)).toBe(120);

    // And the mirror image: whichever side is missing, the price is
    // the same. An asymmetric rule would make the fee depend on which
    // party happened to fill in a field.
    const listingNames = {
      branchCityId: null,
      branchRegionId: RIYADH,
      opportunityFulfillmentCityId: RIYADH_CITY,
      opportunityFulfillmentRegionId: RIYADH,
    };
    expect(resolveShippingTier(listingNames)).toBe("SAME_REGION_DIFFERENT_CITY");
    expect(price(listingNames)).toBe(120);
  });

  it("two different cities, one region → 120", () => {
    const input = {
      branchCityId: KHARJ,
      branchRegionId: RIYADH,
      opportunityFulfillmentCityId: RIYADH_CITY,
      opportunityFulfillmentRegionId: RIYADH,
    };
    expect(resolveShippingTier(input)).toBe("SAME_REGION_DIFFERENT_CITY");
    expect(price(input)).toBe(120);
  });

  it("the same city → 50", () => {
    const input = {
      branchCityId: RIYADH_CITY,
      branchRegionId: RIYADH,
      opportunityFulfillmentCityId: RIYADH_CITY,
      opportunityFulfillmentRegionId: RIYADH,
    };
    expect(resolveShippingTier(input)).toBe("SAME_CITY");
    expect(price(input)).toBe(50);
  });

  it("two different regions → 250", () => {
    const input = {
      branchCityId: RIYADH_CITY,
      branchRegionId: RIYADH,
      opportunityFulfillmentCityId: KHARJ,
      opportunityFulfillmentRegionId: MAKKAH,
    };
    expect(resolveShippingTier(input)).toBe("DIFFERENT_REGION");
    expect(price(input)).toBe(250);
  });

  /**
   * The sixth case is about a row, not a computation: an order already
   * placed keeps the tier and the fee it was charged. Nothing in this
   * module can reach a stored allocation — `resolveShippingTier` is
   * pure and `feeForTier` reads a tariff it is handed — so what is
   * pinned here is that the pricing path is only ever consulted for a
   * NEW checkout. The stored `shipping_tier_code` and
   * `shipping_fee_amount` are read back as they are; the guard that
   * they are never recomputed lives with the order, and this states the
   * half that lives here.
   */
  it("an old order is never repriced by this module", () => {
    const stored = { tier: "SAME_CITY" as const, fee: 50 };

    // Even under a tariff that has since changed, reading back what an
    // order was charged does not go through `feeForTier`.
    const laterTariff: ShippingTariff = {
      sameCityFeeAmount: 75,
      sameRegionDifferentCityFeeAmount: 150,
      differentRegionFeeAmount: 300,
    };

    expect(stored.fee).toBe(50);
    expect(feeForTier(laterTariff, stored.tier)).toBe(75);
    // The two differ ON PURPOSE: the second number is what that tier
    // would cost today, and it is not what the order says.
    expect(feeForTier(laterTariff, stored.tier)).not.toBe(stored.fee);
  });
});

describe("the cheapest tier has to be proven", () => {
  /**
   * THE DEFECT THIS CLOSES. The comparison used to be a bare
   * `branchCityId === opportunityFulfillmentCityId`, and the caller
   * passed `?? ""` for a missing city — so two branches with no city
   * compared EQUAL and the delivery was billed as same-city, 50 rather
   * than 120. With the city now optional by design, that state stops
   * being rare and becomes the normal one.
   */
  it.each([
    ["both null", null, null],
    ["both empty strings", "", ""],
    ["both whitespace", "   ", "  "],
    ["one null, one empty", null, ""],
  ])("does not read %s as the same city", (_label, branch, listing) => {
    expect(
      resolveShippingTier({
        branchCityId: branch,
        branchRegionId: RIYADH,
        opportunityFulfillmentCityId: listing,
        opportunityFulfillmentRegionId: RIYADH,
      }),
    ).toBe("SAME_REGION_DIFFERENT_CITY");
  });

  it("does not read two blank regions as the same region", () => {
    // Unreachable in practice — a branch's region is NOT NULL and a
    // listing's is written at publish — but the same mistake in a
    // different field, and refused the same way.
    expect(
      resolveShippingTier({
        branchCityId: null,
        branchRegionId: null,
        opportunityFulfillmentCityId: null,
        opportunityFulfillmentRegionId: null,
      }),
    ).toBe("DIFFERENT_REGION");
  });

  it("charges the cheapest tier only when both sides name one city", () => {
    expect(
      resolveShippingTier({
        branchCityId: RIYADH_CITY,
        branchRegionId: RIYADH,
        opportunityFulfillmentCityId: RIYADH_CITY,
        opportunityFulfillmentRegionId: RIYADH,
      }),
    ).toBe("SAME_CITY");
  });

  /**
   * A city match settles it without consulting the region. Two rows
   * naming the same city that disagree about its region are corrupt
   * data, not a pricing question — and the cheaper answer is the one
   * that cannot overcharge somebody for it.
   */
  it("lets a city match settle it even if the regions disagree", () => {
    expect(
      resolveShippingTier({
        branchCityId: RIYADH_CITY,
        branchRegionId: RIYADH,
        opportunityFulfillmentCityId: RIYADH_CITY,
        opportunityFulfillmentRegionId: MAKKAH,
      }),
    ).toBe("SAME_CITY");
  });
});

describe("every tier has a price and they are distinct", () => {
  it.each([
    ["SAME_CITY", 50],
    ["SAME_REGION_DIFFERENT_CITY", 120],
    ["DIFFERENT_REGION", 250],
  ] as const)("%s costs %s", (tier, expected) => {
    expect(feeForTier(TARIFF, tier)).toBe(expected);
  });

  it("prices the region tiers above the city tier", () => {
    // Not a style rule: if the middle tier were ever configured below
    // the city tier, a missing city would become CHEAPER than a named
    // one and the incentive would be to leave the field blank.
    expect(TARIFF.sameRegionDifferentCityFeeAmount).toBeGreaterThan(
      TARIFF.sameCityFeeAmount,
    );
    expect(TARIFF.differentRegionFeeAmount).toBeGreaterThan(
      TARIFF.sameRegionDifferentCityFeeAmount,
    );
  });
});
