import { BadRequestException, Body, Controller, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SupplierPayoutService } from "../../settlement/supplier-payout.service";
import { SettleAllocationDto } from "../../settlement/dto/settle-allocation.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

// Admin-only settlement endpoint. AdminSessionAuthGuard requires a
// session established through the full 2FA login flow — there is no
// separate supplier- or trader-facing endpoint for this anywhere in
// the API, by design: suppliers and traders can never trigger their
// own settlement.
@Controller("admin/order-allocations")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminSettlementController {
  constructor(private readonly supplierPayouts: SupplierPayoutService) {}

  @Post(":id/settle")
  settle(
    @Param("id") id: string,
    @Body() dto: SettleAllocationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required");
    }
    return this.supplierPayouts.settle(
      id,
      { externalTransferReference: dto.externalTransferReference },
      { userId: session.adminUserId, requestId: getRequestId(req), ipAddress: req.ip, userAgent: req.headers["user-agent"] },
      idempotencyKey
    );
  }
}
