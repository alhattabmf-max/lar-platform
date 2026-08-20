import { Module } from "@nestjs/common";
import { CommissionTaxPolicyService } from "./commission-tax-policy.service";

@Module({
  providers: [CommissionTaxPolicyService],
  exports: [CommissionTaxPolicyService],
})
export class CommissionTaxPolicyModule {}
