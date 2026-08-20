import { Module } from "@nestjs/common";
import { ReplacementObligationService } from "./replacement-obligation.service";
import { ReplacementShippingWebhookService } from "./replacement-shipping-webhook.service";
import { SupplierReplacementController } from "./supplier-replacement.controller";
import { TraderReplacementController } from "./trader-replacement.controller";
import { ReplacementShippingWebhookController } from "./replacement-shipping-webhook.controller";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";

@Module({
  imports: [FulfillmentModule],
  controllers: [SupplierReplacementController, TraderReplacementController, ReplacementShippingWebhookController],
  providers: [ReplacementObligationService, ReplacementShippingWebhookService],
  exports: [ReplacementObligationService],
})
export class ReplacementModule {}
