import { Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { OrderAllocationService } from "./order-allocation.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";

@Controller("trader/order-allocations")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class TraderFulfillmentController {
  constructor(private readonly orderAllocations: OrderAllocationService) {}

  @Post(":id/confirm-delivery")
  confirmDelivery(@Param("id") id: string, @CurrentSession() session: SessionData, @Req() req: Request) {
    return this.orderAllocations.confirmDeliveryByTrader(id, {
      userId: session.userId,
      companyId: session.companyId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }
}
