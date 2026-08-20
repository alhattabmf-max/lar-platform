import { Module, OnModuleInit } from "@nestjs/common";
import { RefundExecutionService } from "./refund-execution.service";
import { RefundWebhookService } from "./refund-webhook.service";
import { RefundWebhookController } from "./refund-webhook.controller";
import { RefundProviderRegistry } from "./providers/refund-provider.registry";
import { MockRefundProvider } from "./providers/mock-refund.provider";

@Module({
  controllers: [RefundWebhookController],
  providers: [RefundExecutionService, RefundWebhookService, RefundProviderRegistry, MockRefundProvider],
  exports: [RefundExecutionService, RefundWebhookService, RefundProviderRegistry],
})
export class RefundModule implements OnModuleInit {
  constructor(
    private readonly registry: RefundProviderRegistry,
    private readonly mockProvider: MockRefundProvider
  ) {}

  onModuleInit() {
    this.registry.register(this.mockProvider);
  }
}
