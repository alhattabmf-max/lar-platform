import {
  EMAIL_NOTIFICATION_V1,
  RELAY_SUPPORTED_EVENT_TYPES,
  validateEmailNotificationV1,
} from "./payload";
import { EMAIL_TEMPLATE_IDS, TEMPLATE_PARAM_KEYS } from "./templates";

const NOTIFICATION_ID = "11111111-1111-1111-1111-111111111111";
const RECIPIENT_ID = "22222222-2222-2222-2222-222222222222";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    notificationId: NOTIFICATION_ID,
    recipientUserId: RECIPIENT_ID,
    template: "PAYMENT_SUCCEEDED",
    params: { orderId: "33333333-3333-3333-3333-333333333333", amount: "1200.00", currency: "SAR" },
    ...overrides,
  };
}

describe("the supported event type is a code constant", () => {
  it("allows exactly one type", () => {
    expect([...RELAY_SUPPORTED_EVENT_TYPES]).toEqual(["EMAIL_NOTIFICATION_V1"]);
    expect(EMAIL_NOTIFICATION_V1).toBe("EMAIL_NOTIFICATION_V1");
  });

  it.each([
    "CHECKOUT_LOCK_EXPIRED",
    "MASTER_ORDER_FULFILLED",
    "PRODUCT_SUSPENDED",
    "OPPORTUNITY_EXPIRED",
    "REFUND_ATTEMPT_DEFINITIVE_FAILED",
    "SUPPLIER_SETTLEMENT",
  ])("excludes the legacy type %s", (legacy) => {
    expect(RELAY_SUPPORTED_EVENT_TYPES).not.toContain(legacy);
  });
});

describe("a valid payload", () => {
  it("is accepted and returned typed", () => {
    const result = validateEmailNotificationV1(payload());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.template).toBe("PAYMENT_SUCCEEDED");
  });

  it("accepts an empty params object", () => {
    expect(validateEmailNotificationV1(payload({ template: "ORDER_CREATED", params: {} })).ok).toBe(
      true
    );
  });

  it.each(EMAIL_TEMPLATE_IDS)("accepts %s with its own whitelisted params", (template) => {
    const params = Object.fromEntries(TEMPLATE_PARAM_KEYS[template].map((key) => [key, "x"]));

    expect(validateEmailNotificationV1(payload({ template, params })).ok).toBe(true);
  });

  it("accepts a numeric param as well as a string", () => {
    expect(
      validateEmailNotificationV1(payload({ template: "ORDER_CREATED", params: { orderId: 7 } })).ok
    ).toBe(true);
  });
});

describe("the schema is closed", () => {
  it("rejects an unknown top-level key", () => {
    expect(validateEmailNotificationV1(payload({ to: "buyer@example.com" })).ok).toBe(false);
  });

  it("rejects an unknown params key", () => {
    expect(
      validateEmailNotificationV1(payload({ params: { orderId: "x", iban: "SA03..." } })).ok
    ).toBe(false);
  });

  it("rejects a param the template does not accept", () => {
    // disputeId is whitelisted globally but has no place on a payment email.
    expect(
      validateEmailNotificationV1(
        payload({ template: "PAYMENT_SUCCEEDED", params: { disputeId: "x" } })
      ).ok
    ).toBe(false);
  });

  it.each([
    ["a wrong version", { v: 2 }],
    ["a missing version", { v: undefined }],
    ["an unknown template", { template: "SOMETHING_ELSE" }],
    ["a non-uuid notificationId", { notificationId: "nope" }],
    ["a non-uuid recipientUserId", { recipientUserId: "nope" }],
    ["missing params", { params: undefined }],
    ["params as an array", { params: [] }],
    ["params as a string", { params: "orderId=1" }],
  ])("rejects %s", (_label, overrides) => {
    expect(validateEmailNotificationV1(payload(overrides)).ok).toBe(false);
  });

  it("rejects a nested object inside params — scalars only", () => {
    expect(
      validateEmailNotificationV1(payload({ params: { orderId: { id: "x" } } })).ok
    ).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "EMAIL_NOTIFICATION_V1"],
    ["a number", 1],
    ["an array", []],
  ])("rejects %s outright", (_label, input) => {
    expect(validateEmailNotificationV1(input).ok).toBe(false);
  });

  it("carries no email address field at all — the relay resolves it at send time", () => {
    const result = validateEmailNotificationV1(payload());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).not.toHaveProperty("to");
      expect(result.payload).not.toHaveProperty("email");
      expect(result.payload).not.toHaveProperty("recipientEmail");
    }
  });
});

describe("a rejection reveals nothing about the data", () => {
  it("returns only { ok: false }", () => {
    const result = validateEmailNotificationV1(
      payload({ params: { orderId: "x", iban: "SA0380000000608010167519" } })
    );

    expect(result).toEqual({ ok: false });
  });

  it("does not echo the offending value in any form", () => {
    const secret = "SA0380000000608010167519";
    const result = validateEmailNotificationV1(payload({ params: { iban: secret } }));

    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("iban");
  });
});
