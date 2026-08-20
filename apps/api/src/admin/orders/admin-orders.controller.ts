import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { OrdersService } from "../../orders/orders.service";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";

@Controller("admin/orders")
@UseGuards(AdminSessionAuthGuard)
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list() {
    return this.orders.listForAdmin();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.orders.getForAdmin(id);
  }
}
