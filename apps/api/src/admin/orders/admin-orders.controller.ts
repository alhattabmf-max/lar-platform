import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { OrdersService } from "../../orders/orders.service";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { AdminOrdersQueryDto } from "./dto/admin-orders-query.dto";

/**
 * Orders, for an operator.
 *
 * Reads only. Everything that CHANGES an order lives on its own
 * controller behind its own guard and idempotency rules —
 * confirm-delivery, settle, buyer-billing-override, invoice drafts —
 * so this file cannot grow a write by accident.
 */
@Controller("admin/orders")
@UseGuards(AdminSessionAuthGuard)
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: AdminOrdersQueryDto) {
    return this.orders.listForAdmin(query);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.orders.getForAdmin(id);
  }
}
