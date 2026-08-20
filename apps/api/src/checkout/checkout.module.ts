import { Module } from "@nestjs/common";
import { CheckoutSessionService } from "./checkout-session.service";
import { CheckoutController } from "./checkout.controller";
import { ShippingTariffPolicyModule } from "../settings/shipping-tariff-policy.module";
import { CheckoutSettingsModule } from "../settings/checkout-settings.module";

@Module({
  imports: [ShippingTariffPolicyModule, CheckoutSettingsModule],
  controllers: [CheckoutController],
  providers: [CheckoutSessionService],
  exports: [CheckoutSessionService],
})
export class CheckoutModule {}
