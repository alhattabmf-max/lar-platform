import { Module } from "@nestjs/common";
import { InvoiceService } from "./invoice.service";
import { PlatformBillingProfileService } from "./platform-billing-profile.service";
import { InternalDraftInvoiceProvider } from "./internal-draft-invoice.provider";

@Module({
  providers: [InvoiceService, PlatformBillingProfileService, InternalDraftInvoiceProvider],
  exports: [InvoiceService, PlatformBillingProfileService],
})
export class InvoicingModule {}
