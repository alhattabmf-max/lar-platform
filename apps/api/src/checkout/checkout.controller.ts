import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CheckoutSessionService } from "./checkout-session.service";
import { CreateCheckoutSessionDto } from "./dto/create-checkout-session.dto";
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

@Controller("trader/checkout-sessions")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutSessionService) {}

  @Post()
  create(
    @Body() dto: CreateCheckoutSessionDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required");
    }
    return this.checkout.create(dto, idempotencyKey, ctxFrom(session, req));
  }

  @Get(":id")
  getById(@Param("id") id: string, @CurrentSession() session: SessionData, @Req() req: Request) {
    return this.checkout.getById(id, ctxFrom(session, req));
  }

  @Post(":id/abandon")
  abandon(@Param("id") id: string, @CurrentSession() session: SessionData, @Req() req: Request) {
    return this.checkout.abandon(id, ctxFrom(session, req));
  }
}
