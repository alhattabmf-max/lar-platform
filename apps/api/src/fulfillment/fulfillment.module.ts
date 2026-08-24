import { Module, OnModuleInit } from "@nestjs/common";
import { OrderAllocationService } from "./order-allocation.service";
import { ShippingWebhookService } from "./shipping-webhook.service";
import { ShippingProviderRegistry } from "./providers/shipping-provider.registry";
import { MockShippingProvider } from "./providers/mock-shipping.provider";
import { SupplierFulfillmentController } from "./supplier-fulfillment.controller";
import { TraderFulfillmentController } from "./trader-fulfillment.controller";
import { ShippingWebhookController } from "./shipping-webhook.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  // Provides NotificationEventsService, which a service in this
  // module injects. Without it Nest cannot construct that service and
  // the whole application fails to boot.
  imports: [NotificationsModule],
  controllers: [SupplierFulfillmentController, TraderFulfillmentController, ShippingWebhookController],
  providers: [OrderAllocationService, ShippingWebhookService, ShippingProviderRegistry, MockShippingProvider],
  exports: [OrderAllocationService, ShippingProviderRegistry],
})
export class FulfillmentModule implements OnModuleInit {
  constructor(
    private readonly registry: ShippingProviderRegistry,
    private readonly mockProvider: MockShippingProvider
  ) {}

  onModuleInit() {
    this.registry.register(this.mockProvider);
  }
}
