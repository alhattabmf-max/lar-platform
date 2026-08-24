import { Module } from "@nestjs/common";
import { SupplierReplacementReadsService } from "./supplier-replacement-reads.service";
import { SupplierReplacementReadsController } from "./supplier-replacement-reads.controller";
import { ReplacementObligationService } from "./replacement-obligation.service";
import { ReplacementShippingWebhookService } from "./replacement-shipping-webhook.service";
import { SupplierReplacementController } from "./supplier-replacement.controller";
import { TraderReplacementController } from "./trader-replacement.controller";
import { ReplacementShippingWebhookController } from "./replacement-shipping-webhook.controller";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule, FulfillmentModule],
  controllers: [
    SupplierReplacementReadsController,
    SupplierReplacementController,
    TraderReplacementController,
    ReplacementShippingWebhookController,
  ],
  providers: [
    ReplacementObligationService,
    ReplacementShippingWebhookService,
    SupplierReplacementReadsService,
  ],
  exports: [ReplacementObligationService],
})
export class ReplacementModule {}
