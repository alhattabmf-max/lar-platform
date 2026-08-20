import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { OrderAllocationService } from "./order-allocation.service";
import { ShipDto } from "./dto/ship.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";

function ctxFrom(session: SessionData, req: Request) {
  return {
    userId: session.userId,
    companyId: session.companyId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("supplier/order-allocations")
@UseGuards(SessionAuthGuard, RequireSupplierGuard, CsrfGuard)
export class SupplierFulfillmentController {
  constructor(private readonly orderAllocations: OrderAllocationService) {}

  @Post(":id/start-preparation")
  startPreparation(@Param("id") id: string, @CurrentSession() session: SessionData, @Req() req: Request) {
    return this.orderAllocations.startPreparation(id, ctxFrom(session, req));
  }

  @Post(":id/mark-ready")
  markReady(@Param("id") id: string, @CurrentSession() session: SessionData, @Req() req: Request) {
    return this.orderAllocations.markReady(id, ctxFrom(session, req));
  }

  @Post(":id/ship")
  ship(@Param("id") id: string, @Body() dto: ShipDto, @CurrentSession() session: SessionData, @Req() req: Request) {
    return this.orderAllocations.ship(id, dto, ctxFrom(session, req));
  }
}
