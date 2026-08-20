import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { DisputeService } from "./dispute.service";
import { SupplierRespondDto } from "./dto/supplier-respond.dto";
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

@Controller("supplier/disputes")
@UseGuards(SessionAuthGuard, RequireSupplierGuard, CsrfGuard)
export class SupplierDisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Get(":id")
  get(@Param("id") id: string, @CurrentSession() session: SessionData) {
    return this.disputes.getForSupplier(id, session.companyId);
  }

  @Post(":id/respond")
  respond(
    @Param("id") id: string,
    @Body() dto: SupplierRespondDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required");
    return this.disputes.supplierRespondIdempotent(id, dto, ctxFrom(session, req), idempotencyKey);
  }
}
