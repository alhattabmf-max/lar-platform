import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { TraderOrdersController, SupplierOrdersController } from "./orders.controller";

@Module({
  controllers: [TraderOrdersController, SupplierOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
