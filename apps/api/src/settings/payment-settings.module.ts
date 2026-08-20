import { Module } from "@nestjs/common";
import { PaymentSettingsService } from "./payment-settings.service";

@Module({
  providers: [PaymentSettingsService],
  exports: [PaymentSettingsService],
})
export class PaymentSettingsModule {}
