import { Module } from "@nestjs/common";
import { SupplierSettlementService } from "./supplier-settlement.service";
import { SupplierSettlementController } from "./supplier-settlement.controller";
import { SupplierPayoutService } from "./supplier-payout.service";

@Module({
  controllers: [SupplierSettlementController],
  providers: [SupplierPayoutService, SupplierSettlementService],
  exports: [SupplierPayoutService],
})
export class SettlementModule {}
