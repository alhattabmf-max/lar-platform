import { Module } from "@nestjs/common";
import { BankAccountsService } from "./bank-accounts.service";
import { TaxProfileService } from "./tax-profile.service";
import { InvoicingProfileService } from "./invoicing-profile.service";
import { FinancialReadinessService } from "./financial-readiness.service";
import { TraderTaxProfileService } from "./trader-tax-profile.service";
import { MasterOrderBuyerBillingOverrideService } from "./master-order-buyer-billing-override.service";
import { FinancialController } from "./financial.controller";
import { TraderTaxProfileController } from "./trader-tax-profile.controller";
import { BankDataCryptoService } from "../common/security/bank-data-crypto.service";
import { VerificationModule } from "../verification/verification.module";

@Module({
  // VerificationModule: the bank account is one of the things a review
  // covers, so it is closed to edits while one is open.
  imports: [VerificationModule],
  controllers: [FinancialController, TraderTaxProfileController],
  providers: [
    BankAccountsService,
    TaxProfileService,
    InvoicingProfileService,
    FinancialReadinessService,
    TraderTaxProfileService,
    MasterOrderBuyerBillingOverrideService,
    BankDataCryptoService,
  ],
  exports: [FinancialReadinessService, BankAccountsService, TraderTaxProfileService, MasterOrderBuyerBillingOverrideService],
})
export class FinancialModule {}
