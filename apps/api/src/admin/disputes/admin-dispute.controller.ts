import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { DisputeService } from "../../disputes/dispute.service";
import { AdminDecideDisputeDto } from "../../disputes/dto/admin-decide-dispute.dto";
import { AdminDisputesQueryDto } from "./dto/admin-disputes-query.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

// Admin-only. AdminSessionAuthGuard requires a session established
// through the full 2FA login flow.
@Controller("admin/disputes")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminDisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  list(@Query() query: AdminDisputesQueryDto) {
    return this.disputes.listForAdmin(query);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.disputes.getForAdmin(id);
  }

  @Post(":id/decide")
  decide(
    @Param("id") id: string,
    @Body() dto: AdminDecideDisputeDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required");
    // The two amounts pass through UNCONVERTED. They arrive as
    // canonical two-place decimal strings, the DTO has already refused
    // anything else, and the service compares and computes with them as
    // Decimals. The `Number(...)` that used to be here turned a
    // validated decimal into a float on its way into a refund
    // calculation.
    const input = {
      decisionType: dto.decisionType,
      productRefundAmountInclTax: dto.productRefundAmountInclTax,
      shippingRefundAmount: dto.shippingRefundAmount,
      replacementQuantity: dto.replacementQuantity,
      reasonNote: dto.reasonNote,
    };
    return this.disputes.adminDecide(id, input, { userId: session.adminUserId, requestId: getRequestId(req) }, idempotencyKey);
  }
}
