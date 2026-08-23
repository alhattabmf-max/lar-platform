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

  /**
   * Every registered provider code, sorted.
   *
   * The admin screen offers these as the choices for starting a refund
   * attempt. It exists so the UI cannot invent a code: a hardcoded list
   * in the browser would drift the moment a provider is added or
   * removed, and a free-text field would ask an operator to type an
   * internal identifier from memory.
   *
   * Sorted so the order is stable between calls — a Map iterates in
   * insertion order, which is module registration order, which is not
   * something a screen should depend on.
   */
  codes(): string[] {
    return [...this.providers.keys()].sort();
  }
}
