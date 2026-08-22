import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { SupplierOrdersController } from "./orders.controller";
import { TraderOrdersService } from "./trader-orders.service";
import {
  TraderReadsController,
  TraderOrdersReadController,
} from "./trader-reads.controller";

@Module({
  controllers: [TraderOrdersReadController, TraderReadsController, SupplierOrdersController],
  providers: [OrdersService, TraderOrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
