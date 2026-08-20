import { MockShippingProvider } from "./mock-shipping.provider";

describe("MockShippingProvider", () => {
  it("verifies and parses a validly signed webhook", () => {
    const provider = new MockShippingProvider();
    const eventOccurredAt = new Date();
    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: "alloc-1",
      carrierEventId: "evt-1",
      eventType: "DELIVERED",
      eventOccurredAt,
    });
    const parsed = provider.verifyAndParseWebhook(rawBody, headers);
    expect(parsed).not.toBeNull();
    expect(parsed!.orderAllocationReference).toBe("alloc-1");
    expect(parsed!.carrierEventId).toBe("evt-1");
    expect(parsed!.eventType).toBe("DELIVERED");
    expect(parsed!.carrierCode).toBe("MOCK_CARRIER");
    expect(parsed!.eventOccurredAt.getTime()).toBe(eventOccurredAt.getTime());
    expect(typeof parsed!.payloadHash).toBe("string");
  });

  it("rejects a tampered signature", () => {
    const provider = new MockShippingProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: "alloc-1",
      carrierEventId: "evt-1",
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const tampered = { ...headers, "x-mock-shipping-signature": "0".repeat(64) };
    expect(provider.verifyAndParseWebhook(rawBody, tampered)).toBeNull();
  });

  it("does not throw on a signature header of a DIFFERENT length (timingSafeEqual length guard)", () => {
    const provider = new MockShippingProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: "alloc-1",
      carrierEventId: "evt-1",
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const shortSig = { ...headers, "x-mock-shipping-signature": "abcd" };
    expect(() => provider.verifyAndParseWebhook(rawBody, shortSig)).not.toThrow();
    expect(provider.verifyAndParseWebhook(rawBody, shortSig)).toBeNull();
  });

  it("rejects a tampered body", () => {
    const provider = new MockShippingProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: "alloc-1",
      carrierEventId: "evt-1",
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const tamperedBody = Buffer.from(rawBody.toString().replace("alloc-1", "alloc-2"));
    expect(provider.verifyAndParseWebhook(tamperedBody, headers)).toBeNull();
  });

  it("rejects a stale timestamp (replay protection)", () => {
    const provider = new MockShippingProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: "alloc-1",
      carrierEventId: "evt-1",
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
      timestampOverride: new Date(Date.now() - 60 * 60_000),
    });
    expect(provider.verifyAndParseWebhook(rawBody, headers)).toBeNull();
  });

  it("rejects an eventOccurredAt implausibly far in the future", () => {
    const provider = new MockShippingProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: "alloc-1",
      carrierEventId: "evt-1",
      eventType: "DELIVERED",
      eventOccurredAt: new Date(Date.now() + 60 * 60_000),
    });
    expect(provider.verifyAndParseWebhook(rawBody, headers)).toBeNull();
  });

  it("rejects a payload whose carrierCode does not match this provider", () => {
    const provider = new MockShippingProvider();
    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: "alloc-1",
      carrierCode: "SOME_OTHER_CARRIER",
      carrierEventId: "evt-1",
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    expect(provider.verifyAndParseWebhook(rawBody, headers)).toBeNull();
  });

  it("rejects missing signature/timestamp headers", () => {
    const provider = new MockShippingProvider();
    const { rawBody } = provider.buildSignedWebhook({
      orderAllocationReference: "alloc-1",
      carrierEventId: "evt-1",
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    expect(provider.verifyAndParseWebhook(rawBody, {})).toBeNull();
  });
});
