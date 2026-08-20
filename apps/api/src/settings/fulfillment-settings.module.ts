import { Module } from "@nestjs/common";
import { FulfillmentSettingsService } from "./fulfillment-settings.service";

@Module({
  providers: [FulfillmentSettingsService],
  exports: [FulfillmentSettingsService],
})
export class FulfillmentSettingsModule {}
