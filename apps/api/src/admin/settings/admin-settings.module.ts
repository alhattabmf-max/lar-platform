import { Module } from "@nestjs/common";
import { AdminSettingsService } from "./admin-settings.service";
import { AdminSettingsController } from "./admin-settings.controller";
import { SecuritySettingsModule } from "../../settings/security-settings.module";
import { MediaPolicyModule } from "../../settings/media-policy.module";
import { FinancialSettingsModule } from "../../settings/financial-settings.module";
import { TaxRateSettingsModule } from "../../settings/tax-rate-settings.module";
import { OpportunitySettingsModule } from "../../settings/opportunity-settings.module";
import { ShareTierSettingsModule } from "../../settings/share-tier-settings.module";
import { CommissionPolicyModule } from "../../settings/commission-policy.module";
import { CheckoutSettingsModule } from "../../settings/checkout-settings.module";
import { ShippingTariffPolicyModule } from "../../settings/shipping-tariff-policy.module";
import { CommissionTaxPolicyModule } from "../../settings/commission-tax-policy.module";
import { PaymentSettingsModule } from "../../settings/payment-settings.module";
import { FulfillmentSettingsModule } from "../../settings/fulfillment-settings.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [
    AdminSessionModule,
    SecuritySettingsModule,
    MediaPolicyModule,
    FinancialSettingsModule,
    TaxRateSettingsModule,
    OpportunitySettingsModule,
    ShareTierSettingsModule,
    CommissionPolicyModule,
    CheckoutSettingsModule,
    ShippingTariffPolicyModule,
    CommissionTaxPolicyModule,
    PaymentSettingsModule,
    FulfillmentSettingsModule,
  ],
  controllers: [AdminSettingsController],
  providers: [AdminSettingsService],
})
export class AdminSettingsModule {}
