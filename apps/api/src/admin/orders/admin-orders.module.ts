import { Module } from "@nestjs/common";
import { AdminOrdersController } from "./admin-orders.controller";
import { OrdersModule } from "../../orders/orders.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [OrdersModule, AdminSessionModule],
  controllers: [AdminOrdersController],
})
export class AdminOrdersModule {}
