import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ReplacementObligationService } from "../../replacement/replacement-obligation.service";
import { AdminConfirmReplacementDeliveryDto } from "../../replacement/dto/admin-confirm-replacement-delivery.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

function ctxFrom(session: AdminSessionData, req: Request) {
  return {
    userId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("admin/replacement-obligations")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminReplacementController {
  constructor(private readonly replacementObligations: ReplacementObligationService) {}

  @Post(":id/confirm-delivery")
  confirmDelivery(
    @Param("id") id: string,
    @Body() dto: AdminConfirmReplacementDeliveryDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.replacementObligations.confirmDeliveryByAdmin(id, dto.reasonNote, ctxFrom(session, req));
  }

  @Post(":id/mark-failed")
  markFailed(@Param("id") id: string, @CurrentAdminSession() session: AdminSessionData, @Req() req: Request) {
    return this.replacementObligations.markFailed(id, ctxFrom(session, req));
  }
}
