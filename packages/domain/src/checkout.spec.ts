import { resolveShippingTier, feeForTier } from "./checkout-shipping-tier";
import { computeCheckoutCooldown } from "./checkout-cooldown";

describe("resolveShippingTier", () => {
  it("returns SAME_CITY when branch city matches fulfillment city", () => {
    expect(
      resolveShippingTier({
        branchCityId: "riyadh",
        branchRegionId: "central",
        opportunityFulfillmentCityId: "riyadh",
        opportunityFulfillmentRegionId: "central",
      })
    ).toBe("SAME_CITY");
  });

  it("returns SAME_REGION_DIFFERENT_CITY when only the region matches", () => {
    expect(
      resolveShippingTier({
        branchCityId: "kharj",
        branchRegionId: "central",
        opportunityFulfillmentCityId: "riyadh",
        opportunityFulfillmentRegionId: "central",
      })
    ).toBe("SAME_REGION_DIFFERENT_CITY");
  });

  it("returns DIFFERENT_REGION when neither matches", () => {
    expect(
      resolveShippingTier({
        branchCityId: "najran-city",
        branchRegionId: "najran",
        opportunityFulfillmentCityId: "riyadh",
        opportunityFulfillmentRegionId: "central",
      })
    ).toBe("DIFFERENT_REGION");
  });
});

describe("feeForTier", () => {
  const tariff = { sameCityFeeAmount: 10, sameRegionDifferentCityFeeAmount: 25, differentRegionFeeAmount: 50 };
  it.each([
    ["SAME_CITY", 10],
    ["SAME_REGION_DIFFERENT_CITY", 25],
    ["DIFFERENT_REGION", 50],
  ] as const)("%s -> %d", (tier, expected) => {
    expect(feeForTier(tariff, tier)).toBe(expected);
  });
});

describe("computeCheckoutCooldown", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  it("does not block below the threshold", () => {
    const events = [new Date("2026-08-19T11:50:00Z"), new Date("2026-08-19T11:55:00Z")];
    const result = computeCheckoutCooldown(events, 3, 60, 30, now);
    expect(result.blocked).toBe(false);
    expect(result.cooldownUntil).toBeNull();
  });

  it("anchors cooldownUntil to the NEWEST of the last 3 events, not the oldest", () => {
    const events = [
      new Date("2026-08-19T11:00:00Z"),
      new Date("2026-08-19T11:30:00Z"),
      new Date("2026-08-19T11:45:00Z"),
    ];
    const result = computeCheckoutCooldown(events, 3, 60, 30, now);
    expect(result.cooldownUntil).toEqual(new Date("2026-08-19T12:15:00Z"));
    expect(result.blocked).toBe(true);
  });

  it("is no longer blocked once cooldownUntil has passed, without a new qualifying event", () => {
    const events = [
      new Date("2026-08-19T10:00:00Z"),
      new Date("2026-08-19T10:15:00Z"),
      new Date("2026-08-19T10:20:00Z"),
    ];
    const result = computeCheckoutCooldown(events, 3, 60, 30, now);
    expect(result.blocked).toBe(false);
  });

  it("does not treat a stale group (oldest of the 3 outside the window) as qualifying", () => {
    const events = [
      new Date("2026-08-19T10:00:00Z"),
      new Date("2026-08-19T11:50:00Z"),
      new Date("2026-08-19T11:55:00Z"),
    ];
    const result = computeCheckoutCooldown(events, 3, 60, 30, now);
    expect(result.blocked).toBe(false);
    expect(result.cooldownUntil).toBeNull();
  });

  it("uses only the last `threshold` events even if more exist", () => {
    const events = [
      new Date("2026-08-19T09:00:00Z"),
      new Date("2026-08-19T11:40:00Z"),
      new Date("2026-08-19T11:50:00Z"),
      new Date("2026-08-19T11:55:00Z"),
    ];
    const result = computeCheckoutCooldown(events, 3, 60, 30, now);
    expect(result.cooldownUntil).toEqual(new Date("2026-08-19T12:25:00Z"));
  });
});
