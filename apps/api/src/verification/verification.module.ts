import { Module } from "@nestjs/common";
import { FinancialSettingsModule } from "../settings/financial-settings.module";
import { VERIFICATION_PROVIDER } from "./verification-provider.interface";
import { MockVerificationProvider } from "./mock-verification.provider";
import { VerificationService } from "./verification.service";
import { SupplierVerificationRequestService } from "./supplier-verification-request.service";
import { SupplierVerificationRequestController } from "./supplier-verification-request.controller";

/**
 * Verification, as one reviewed request.
 *
 * THE OLD SELF-SERVICE ROUTE IS GONE. `POST /verification/reapply`
 * moved a REJECTED company straight back to PENDING with nothing
 * reviewed and nobody deciding — a supplier could refuse their own
 * refusal. Re-opening a refused application is an administrator's
 * decision now, and the only route a supplier has is to submit its
 * whole record for review.
 *
 * `VerificationService` stays: it still runs the automatic check at
 * registration, and its guarded transition is what the admin console's
 * suspend and reinstate paths use.
 */
@Module({
  imports: [FinancialSettingsModule],
  controllers: [SupplierVerificationRequestController],
  providers: [
    { provide: VERIFICATION_PROVIDER, useClass: MockVerificationProvider },
    VerificationService,
    SupplierVerificationRequestService,
  ],
  exports: [VerificationService, SupplierVerificationRequestService],
})
export class VerificationModule {}
