import { Module } from "@nestjs/common";
import { ShippingTariffPolicyService } from "./shipping-tariff-policy.service";

@Module({
  providers: [ShippingTariffPolicyService],
  exports: [ShippingTariffPolicyService],
})
export class ShippingTariffPolicyModule {}
