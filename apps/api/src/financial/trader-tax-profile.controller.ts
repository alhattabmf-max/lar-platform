import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { TraderTaxProfileService } from "./trader-tax-profile.service";
import { UpdateTraderTaxProfileDto } from "./dto/update-trader-tax-profile.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";
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

@Controller("trader/settings/tax-profile")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class TraderTaxProfileController {
  constructor(private readonly taxProfile: TraderTaxProfileService) {}

  @Get()
  get(@CurrentSession() session: SessionData) {
    return this.taxProfile.get(session.companyId);
  }

  @Put()
  set(@Body() dto: UpdateTraderTaxProfileDto, @CurrentSession() session: SessionData, @Req() req: Request) {
    return this.taxProfile.upsert(dto, ctxFrom(session, req));
  }
}
