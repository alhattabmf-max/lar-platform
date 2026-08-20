import { MockPaymentProvider } from "./mock-payment.provider";

describe("MockPaymentProvider", () => {
  it("createPaymentIntent with the SAME idempotencyKey/merchantReference returns the SAME providerReference", async () => {
    const provider = new MockPaymentProvider();
    const input = { amount: 100, currency: "SAR", idempotencyKey: "key-1", merchantReference: "attempt-1" };
    const r1 = await provider.createPaymentIntent(input);
    const r2 = await provider.createPaymentIntent(input);
    expect(r1).toEqual(r2);
    expect(r1.outcome).toBe("CREATED");
  });

  it("returns CREATED with a providerReference by default", async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.createPaymentIntent({ amount: 50, currency: "SAR", idempotencyKey: "k", merchantReference: "m" });
    expect(result).toEqual({ outcome: "CREATED", providerReference: "mock_ref_m" });
  });

  it("setNextCreateIntentResult forces a DEFINITIVE_FAILURE outcome exactly once, then reverts to default", async () => {
    const provider = new MockPaymentProvider();
    provider.setNextCreateIntentResult({ outcome: "DEFINITIVE_FAILURE", reason: "card declined" });

    const first = await provider.createPaymentIntent({ amount: 10, currency: "SAR", idempotencyKey: "k1", merchantReference: "m1" });
    expect(first).toEqual({ outcome: "DEFINITIVE_FAILURE", reason: "card declined" });

    const second = await provider.createPaymentIntent({ amount: 10, currency: "SAR", idempotencyKey: "k2", merchantReference: "m2" });
    expect(second.outcome).toBe("CREATED");
  });

  it("setNextCreateIntentResult forces a RETRYABLE_UNKNOWN outcome exactly once", async () => {
    const provider = new MockPaymentProvider();
    provider.setNextCreateIntentResult({ outcome: "RETRYABLE_UNKNOWN", reason: "network timeout" });

    const result = await provider.createPaymentIntent({ amount: 10, currency: "SAR", idempotencyKey: "k", merchantReference: "m" });
    expect(result).toEqual({ outcome: "RETRYABLE_UNKNOWN", reason: "network timeout" });
  });

  it("buildSignedWebhook produces a payload that verifyAndParseWebhook accepts and parses correctly", () => {
    const provider = new MockPaymentProvider();
    const capturedAt = new Date();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: "attempt-42",
      providerReference: "ref-42",
      providerEventId: "evt-42",
      eventType: "SUCCESS",
      providerCapturedAt: capturedAt,
      providerCapturedAmount: 123.45,
      providerFeeAmount: 1.5,
    });

    const parsed = provider.verifyAndParseWebhook(rawBody, headers);
    expect(parsed).not.toBeNull();
    expect(parsed!.merchantReference).toBe("attempt-42");
    expect(parsed!.providerReference).toBe("ref-42");
    expect(parsed!.providerEventId).toBe("evt-42");
    expect(parsed!.eventType).toBe("SUCCESS");
    expect(parsed!.currency).toBe("SAR");
    expect(parsed!.providerCapturedAmount).toBe(123.45);
    expect(parsed!.providerFeeAmount).toBe(1.5);
    expect(parsed!.providerCapturedAt?.getTime()).toBe(capturedAt.getTime());
    expect(parsed!.providerCode).toBe("MOCK");
    expect(typeof parsed!.payloadHash).toBe("string");
    expect(parsed!.payloadHash.length).toBeGreaterThan(0);
  });

  it("a FAILURE webhook parses with no providerCapturedAt/Amount", () => {
    const provider = new MockPaymentProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: "attempt-fail",
      providerReference: "ref-fail",
      providerEventId: "evt-fail",
      eventType: "FAILURE",
    });
    const parsed = provider.verifyAndParseWebhook(rawBody, headers);
    expect(parsed).not.toBeNull();
    expect(parsed!.eventType).toBe("FAILURE");
    expect(parsed!.providerCapturedAt).toBeUndefined();
    expect(parsed!.providerCapturedAmount).toBeUndefined();
  });

  it("rejects a webhook with a tampered/wrong signature", () => {
    const provider = new MockPaymentProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: "m",
      providerReference: "r",
      providerEventId: "e",
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: 10,
    });
    const tamperedHeaders = { ...headers, "x-mock-signature": "0".repeat(64) };
    expect(provider.verifyAndParseWebhook(rawBody, tamperedHeaders)).toBeNull();
  });

  it("rejects a webhook whose body was tampered with after signing", () => {
    const provider = new MockPaymentProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: "m",
      providerReference: "r",
      providerEventId: "e",
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: 10,
    });
    const tamperedBody = Buffer.from(rawBody.toString().replace('"providerCapturedAmount":10', '"providerCapturedAmount":99999'));
    expect(provider.verifyAndParseWebhook(tamperedBody, headers)).toBeNull();
  });

  it("rejects a webhook with a timestamp far in the past (replay protection)", () => {
    const provider = new MockPaymentProvider();
    const oldTimestamp = new Date(Date.now() - 60 * 60_000);
    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: "m",
      providerReference: "r",
      providerEventId: "e",
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: 10,
      timestampOverride: oldTimestamp,
    });
    expect(provider.verifyAndParseWebhook(rawBody, headers)).toBeNull();
  });

  it("rejects a webhook missing the signature/timestamp headers entirely", () => {
    const provider = new MockPaymentProvider();
    const { rawBody } = provider.buildSignedWebhook({
      merchantReference: "m",
      providerReference: "r",
      providerEventId: "e",
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: 10,
    });
    expect(provider.verifyAndParseWebhook(rawBody, {})).toBeNull();
  });
});
