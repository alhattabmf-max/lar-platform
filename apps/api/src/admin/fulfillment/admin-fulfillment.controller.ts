import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { OrderAllocationService } from "../../fulfillment/order-allocation.service";
import { AdminConfirmDeliveryDto } from "../../fulfillment/dto/admin-confirm-delivery.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

@Controller("admin/order-allocations")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminFulfillmentController {
  constructor(private readonly orderAllocations: OrderAllocationService) {}

  @Post(":id/confirm-delivery")
  confirmDelivery(
    @Param("id") id: string,
    @Body() dto: AdminConfirmDeliveryDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.orderAllocations.confirmDeliveryByAdmin(id, dto.reasonNote, {
      userId: session.adminUserId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }
}
