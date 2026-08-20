import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

@Controller("trader/orders")
@UseGuards(SessionAuthGuard, RequireTraderGuard)
export class TraderOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentSession() session: SessionData) {
    return this.orders.listForTrader(session.companyId);
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentSession() session: SessionData) {
    return this.orders.getForTrader(id, session.companyId);
  }
}

@Controller("supplier/orders")
@UseGuards(SessionAuthGuard, RequireSupplierGuard)
export class SupplierOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentSession() session: SessionData) {
    return this.orders.listForSupplier(session.companyId);
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentSession() session: SessionData) {
    return this.orders.getForSupplier(id, session.companyId);
  }
}
