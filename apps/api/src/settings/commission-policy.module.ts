import { Module } from "@nestjs/common";
import { CommissionPolicyService } from "./commission-policy.service";

@Module({
  providers: [CommissionPolicyService],
  exports: [CommissionPolicyService],
})
export class CommissionPolicyModule {}
