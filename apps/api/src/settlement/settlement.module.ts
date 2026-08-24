import { Module } from "@nestjs/common";
import { SupplierSettlementService } from "./supplier-settlement.service";
import { SupplierSettlementController } from "./supplier-settlement.controller";
import { SupplierPayoutService } from "./supplier-payout.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  // Provides NotificationEventsService, which a service in this
  // module injects. Without it Nest cannot construct that service and
  // the whole application fails to boot.
  imports: [NotificationsModule],
  controllers: [SupplierSettlementController],
  providers: [SupplierPayoutService, SupplierSettlementService],
  exports: [SupplierPayoutService],
})
export class SettlementModule {}
