import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { RefundExecutionService } from "../../refunds/refund-execution.service";
import { StartRefundAttemptDto } from "../../refunds/dto/start-refund-attempt.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

// Admin-only. AdminSessionAuthGuard requires a session established
// through the full 2FA login flow. There is no supplier- or
// trader-facing endpoint anywhere that can start or view a refund
// execution — by design.
@Controller("admin/refund-obligations")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminRefundController {
  constructor(private readonly execution: RefundExecutionService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.execution.getObligation(id);
  }

  @Post(":id/attempts")
  startAttempt(
    @Param("id") id: string,
    @Body() dto: StartRefundAttemptDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required");
    return this.execution.startAttemptIdempotent(id, dto.providerCode, { userId: session.adminUserId, requestId: getRequestId(req) }, idempotencyKey);
  }
}
