import { Module } from "@nestjs/common";
import { PaymentAttemptService } from "./payment-attempt.service";
import { PaymentWebhookService } from "./payment-webhook.service";
import { PaymentsController } from "./payments.controller";
import { PaymentWebhookController } from "./payment-webhook.controller";
import { MockPaymentProvider } from "./providers/mock-payment.provider";
import { PaymentSettingsModule } from "../settings/payment-settings.module";
import { CommissionTaxPolicyModule } from "../settings/commission-tax-policy.module";

@Module({
  imports: [PaymentSettingsModule, CommissionTaxPolicyModule],
  controllers: [PaymentsController, PaymentWebhookController],
  providers: [
    { provide: "PaymentProvider", useClass: MockPaymentProvider },
    PaymentAttemptService,
    PaymentWebhookService,
  ],
  exports: [PaymentAttemptService, PaymentWebhookService, "PaymentProvider"],
})
export class PaymentsModule {}
