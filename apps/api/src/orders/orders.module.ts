import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { TraderOrdersService } from "./trader-orders.service";
import {
  TraderReadsController,
  TraderOrdersReadController,
} from "./trader-reads.controller";
import { SupplierOrdersService } from "./supplier-orders.service";
import { SupplierOrdersReadController } from "./supplier-reads.controller";

@Module({
  controllers: [
    TraderOrdersReadController,
    TraderReadsController,
    SupplierOrdersReadController,
  ],
  providers: [OrdersService, TraderOrdersService, SupplierOrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
