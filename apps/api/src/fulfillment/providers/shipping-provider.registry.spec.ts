import { ShippingProviderRegistry } from "./shipping-provider.registry";
import { MockShippingProvider } from "./mock-shipping.provider";
import type { ShippingProvider, VerifiedCarrierEventPayload } from "./shipping-provider.interface";

class FakeProvider implements ShippingProvider {
  readonly carrierCode: string;
  constructor(carrierCode: string) {
    this.carrierCode = carrierCode;
  }
  verifyAndParseWebhook(): VerifiedCarrierEventPayload | null {
    return null;
  }
}

describe("ShippingProviderRegistry", () => {
  it("returns undefined for a carrier that was never registered", () => {
    const registry = new ShippingProviderRegistry();
    expect(registry.get("MOCK_CARRIER")).toBeUndefined();
  });

  it("returns the exact registered provider instance by its carrierCode", () => {
    const registry = new ShippingProviderRegistry();
    const provider = new MockShippingProvider();
    registry.register(provider);
    expect(registry.get("MOCK_CARRIER")).toBe(provider);
  });

  it("keeps multiple distinct carriers independently addressable", () => {
    const registry = new ShippingProviderRegistry();
    const providerA = new FakeProvider("CARRIER_A");
    const providerB = new FakeProvider("CARRIER_B");
    registry.register(providerA);
    registry.register(providerB);
    expect(registry.get("CARRIER_A")).toBe(providerA);
    expect(registry.get("CARRIER_B")).toBe(providerB);
    expect(registry.get("CARRIER_C")).toBeUndefined();
  });

  it("registering a second provider under the same carrierCode replaces the first", () => {
    const registry = new ShippingProviderRegistry();
    const first = new FakeProvider("SAME_CODE");
    const second = new FakeProvider("SAME_CODE");
    registry.register(first);
    registry.register(second);
    expect(registry.get("SAME_CODE")).toBe(second);
  });

  it("carrier code lookups are exact-match (case-sensitive) — no accidental normalization", () => {
    const registry = new ShippingProviderRegistry();
    const provider = new MockShippingProvider();
    registry.register(provider);
    expect(registry.get("mock_carrier")).toBeUndefined();
    expect(registry.get("Mock_Carrier")).toBeUndefined();
  });
});
