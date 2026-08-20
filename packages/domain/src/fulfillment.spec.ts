import { isValidOrderAllocationTransition, classifyFulfillmentDelay } from "./fulfillment";

describe("isValidOrderAllocationTransition", () => {
  it("allows exactly the four forward transitions", () => {
    expect(isValidOrderAllocationTransition("AWAITING_PREPARATION", "PREPARING")).toBe(true);
    expect(isValidOrderAllocationTransition("PREPARING", "READY_TO_SHIP")).toBe(true);
    expect(isValidOrderAllocationTransition("READY_TO_SHIP", "SHIPPED")).toBe(true);
    expect(isValidOrderAllocationTransition("SHIPPED", "DELIVERED")).toBe(true);
  });

  it("rejects skipping a state", () => {
    expect(isValidOrderAllocationTransition("AWAITING_PREPARATION", "SHIPPED")).toBe(false);
    expect(isValidOrderAllocationTransition("AWAITING_PREPARATION", "DELIVERED")).toBe(false);
    expect(isValidOrderAllocationTransition("PREPARING", "SHIPPED")).toBe(false);
  });

  it("rejects any backward transition", () => {
    expect(isValidOrderAllocationTransition("DELIVERED", "SHIPPED")).toBe(false);
    expect(isValidOrderAllocationTransition("SHIPPED", "READY_TO_SHIP")).toBe(false);
  });

  it("rejects staying in the same state", () => {
    expect(isValidOrderAllocationTransition("PREPARING", "PREPARING")).toBe(false);
  });

  it("DELIVERED has no further allowed transitions", () => {
    expect(isValidOrderAllocationTransition("DELIVERED", "DELIVERED")).toBe(false);
  });
});

describe("classifyFulfillmentDelay", () => {
  const paidAt = new Date("2026-01-01T00:00:00Z");
  const preparationDueAt = new Date("2026-01-04T00:00:00Z"); // 3 days window
  const thresholds = { lateThresholdPercent: 100, criticalThresholdPercent: 130 };

  it("is ON_TIME well within the window", () => {
    const referenceTime = new Date("2026-01-02T00:00:00Z"); // 1/3 elapsed
    expect(classifyFulfillmentDelay({ paidAt, preparationDueAt, referenceTime, ...thresholds })).toBe("ON_TIME");
  });

  it("is ON_TIME exactly at the 100% boundary", () => {
    expect(classifyFulfillmentDelay({ paidAt, preparationDueAt, referenceTime: preparationDueAt, ...thresholds })).toBe("ON_TIME");
  });

  it("is LATE just past the 100% boundary", () => {
    const referenceTime = new Date(preparationDueAt.getTime() + 1000);
    expect(classifyFulfillmentDelay({ paidAt, preparationDueAt, referenceTime, ...thresholds })).toBe("LATE");
  });

  it("is LATE exactly at the 130% boundary", () => {
    const referenceTime = new Date(paidAt.getTime() + (preparationDueAt.getTime() - paidAt.getTime()) * 1.3);
    expect(classifyFulfillmentDelay({ paidAt, preparationDueAt, referenceTime, ...thresholds })).toBe("LATE");
  });

  it("is CRITICAL just past the 130% boundary", () => {
    const referenceTime = new Date(paidAt.getTime() + (preparationDueAt.getTime() - paidAt.getTime()) * 1.3 + 1000);
    expect(classifyFulfillmentDelay({ paidAt, preparationDueAt, referenceTime, ...thresholds })).toBe("CRITICAL");
  });

  it("anchors to paidAt, NOT preparationStartedAt — starting late does not reset the clock", () => {
    // Even if preparation started very late (e.g. day 2 of 3), the
    // ratio is still computed from paidAt, so this is still ON_TIME
    // as long as the reference time itself is within the window.
    const referenceTime = new Date("2026-01-03T12:00:00Z"); // still within window
    expect(classifyFulfillmentDelay({ paidAt, preparationDueAt, referenceTime, ...thresholds })).toBe("ON_TIME");
  });
});
