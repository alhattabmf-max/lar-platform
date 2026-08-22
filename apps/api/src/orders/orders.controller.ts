import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

// The trader-facing order routes moved to trader-reads.controller.ts
// in 8D.3, where they gained pagination, inline allocations and a
// projection that withholds commission and supplier financial data.
// The supplier view below is unchanged; widening it is 8E.
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
