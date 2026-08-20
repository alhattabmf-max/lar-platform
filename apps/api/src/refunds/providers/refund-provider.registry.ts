import { Injectable } from "@nestjs/common";
import type { RefundProvider } from "./refund-provider.interface";

@Injectable()
export class RefundProviderRegistry {
  private readonly providers = new Map<string, RefundProvider>();

  register(provider: RefundProvider): void {
    this.providers.set(provider.providerCode, provider);
  }

  get(providerCode: string): RefundProvider | undefined {
    return this.providers.get(providerCode);
  }
}
