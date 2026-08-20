import { Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ReplacementObligationService } from "./replacement-obligation.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";

@Controller("trader/replacement-obligations")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class TraderReplacementController {
  constructor(private readonly replacementObligations: ReplacementObligationService) {}

  @Post(":id/confirm-delivery")
  confirmDelivery(@Param("id") id: string, @CurrentSession() session: SessionData, @Req() req: Request) {
    return this.replacementObligations.confirmDeliveryByTrader(id, {
      userId: session.userId,
      companyId: session.companyId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }
}
