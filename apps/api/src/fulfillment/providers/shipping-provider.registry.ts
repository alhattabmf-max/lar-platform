import { Injectable } from "@nestjs/common";
import type { ShippingProvider } from "./shipping-provider.interface";

/**
 * Only registered carriers can ever reach webhook processing — an
 * unregistered carrier code in the URL is rejected with 404 before
 * any signature verification is even attempted.
 */
@Injectable()
export class ShippingProviderRegistry {
  private readonly providers = new Map<string, ShippingProvider>();

  register(provider: ShippingProvider): void {
    this.providers.set(provider.carrierCode, provider);
  }

  get(carrierCode: string): ShippingProvider | undefined {
    return this.providers.get(carrierCode);
  }
}
