import {
  NOTIFICATION_PARAM_KEYS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_PARAM_KEYS,
  type NotificationType,
} from "@platform/types";
import {
  InvalidNotificationParamsError,
  assertValidNotificationParams,
  isValidNotificationParams,
} from "./notification-params";

describe("the per-type whitelist, not just a global one", () => {
  it.each(NOTIFICATION_TYPES)("accepts %s with exactly its own keys", (type) => {
    const params = Object.fromEntries(NOTIFICATION_TYPE_PARAM_KEYS[type].map((k) => [k, "x"]));

    expect(isValidNotificationParams(type, params)).toBe(true);
  });

  it.each(NOTIFICATION_TYPES)("accepts %s with no params at all", (type) => {
    expect(isValidNotificationParams(type, {})).toBe(true);
  });

  it("rejects a globally-legal key the type does not allow", () => {
    // `disputeId` is a legal key somewhere; on a settlement it is not.
    expect(() => assertValidNotificationParams("SETTLEMENT_EXECUTED", { disputeId: "x" })).toThrow(
      /NOT_ALLOWED_FOR_TYPE/
    );
  });

  it("rejects an amount on a type that carries no money", () => {
    expect(() => assertValidNotificationParams("ORDER_CREATED", { amount: "100" })).toThrow(
      /NOT_ALLOWED_FOR_TYPE/
    );
  });

  it("declares allowed keys for every type", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TYPE_PARAM_KEYS[type]).toBeDefined();
    }
  });

  it("never whitelists a key outside the global vocabulary", () => {
    for (const type of NOTIFICATION_TYPES) {
      for (const key of NOTIFICATION_TYPE_PARAM_KEYS[type]) {
        expect(NOTIFICATION_PARAM_KEYS).toContain(key);
      }
    }
  });
});

describe("keys outside the vocabulary are refused outright", () => {
  it.each([
    ["an iban", { iban: "SA0380000000608010167519" }],
    ["an email", { email: "buyer@example.com" }],
    ["a bank reference", { externalTransferReference: "TRF-1" }],
    ["a message", { message: "Payment failed: card declined" }],
    ["evidence", { evidence: "photo.jpg" }],
    ["a company name", { companyName: "Acme" }],
  ])("rejects %s", (_label, params) => {
    expect(() => assertValidNotificationParams("PAYMENT_SUCCEEDED", params)).toThrow(
      /UNKNOWN_KEY/
    );
  });

  it("rejects an unknown key even when every other key is valid", () => {
    expect(() =>
      assertValidNotificationParams("PAYMENT_SUCCEEDED", {
        orderId: "o",
        amount: "1",
        currency: "SAR",
        iban: "SA03",
      })
    ).toThrow(/UNKNOWN_KEY/);
  });
});

describe("scalars only — no structure, no free text container", () => {
  it.each([
    ["an object", { orderId: { id: "x" } }],
    ["an array", { orderId: ["x"] }],
    ["a boolean", { orderId: true }],
    ["null", { orderId: null }],
  ])("rejects %s", (_label, params) => {
    expect(() => assertValidNotificationParams("ORDER_CREATED", params)).toThrow(/NON_SCALAR/);
  });

  it("accepts a number as readily as a string", () => {
    expect(isValidNotificationParams("SETTLEMENT_EXECUTED", { amount: 1200 })).toBe(true);
  });

  it("ignores an explicitly undefined value rather than failing on it", () => {
    expect(isValidNotificationParams("ORDER_CREATED", { orderId: undefined })).toBe(true);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "orderId=1"],
    ["a number", 5],
  ])("rejects params that are %s", (_label, params) => {
    expect(() => assertValidNotificationParams("ORDER_CREATED", params)).toThrow(/NOT_AN_OBJECT/);
  });
});

describe("a rejection reveals nothing about the data", () => {
  it("carries only a reason code", () => {
    const secret = "SA0380000000608010167519";

    try {
      assertValidNotificationParams("ORDER_CREATED", { iban: secret });
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidNotificationParamsError);
      expect((error as InvalidNotificationParamsError).reason).toBe("UNKNOWN_KEY");
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("iban");
    }
  });

  it("does not echo an offending value for a non-scalar either", () => {
    const secret = "internal-detail";

    try {
      assertValidNotificationParams("ORDER_CREATED", { orderId: { secret } });
      throw new Error("expected a rejection");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("validation never silently strips", () => {
  it("returns the params unchanged when valid", () => {
    const params = { orderId: "o-1", amount: "12.50", currency: "SAR" };

    expect(assertValidNotificationParams("PAYMENT_SUCCEEDED", params)).toEqual(params);
  });

  it("fails rather than dropping an offending key and continuing", () => {
    // Dropping it would hide a producer bug until someone noticed a
    // message missing its order number.
    const type: NotificationType = "ORDER_CREATED";

    expect(() => assertValidNotificationParams(type, { orderId: "o", amount: "1" })).toThrow();
  });
});
