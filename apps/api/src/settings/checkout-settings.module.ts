import { Module } from "@nestjs/common";
import { CheckoutSettingsService } from "./checkout-settings.service";

@Module({
  providers: [CheckoutSettingsService],
  exports: [CheckoutSettingsService],
})
export class CheckoutSettingsModule {}
