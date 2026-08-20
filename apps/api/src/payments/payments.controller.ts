import { BadRequestException, Body, Controller, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { PaymentAttemptService } from "./payment-attempt.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";

@Controller("trader/checkout-sessions")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class PaymentsController {
  constructor(private readonly paymentAttempts: PaymentAttemptService) {}

  @Post(":id/payment-attempts")
  startPayment(
    @Param("id") id: string,
    @Body() _body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required");
    }
    return this.paymentAttempts.startPayment(id, idempotencyKey, {
      userId: session.userId,
      companyId: session.companyId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }
}
