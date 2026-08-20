import { Module } from "@nestjs/common";
import { SupplierPayoutService } from "./supplier-payout.service";

@Module({
  providers: [SupplierPayoutService],
  exports: [SupplierPayoutService],
})
export class SettlementModule {}
