import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { MasterOrderBuyerBillingOverrideService } from "../../financial/master-order-buyer-billing-override.service";
import { CreateBuyerBillingOverrideDto } from "../../financial/dto/create-buyer-billing-override.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

// Admin-only. AdminSessionAuthGuard requires a session established
// through the full 2FA login flow. The request body carries ONLY
// reasonNote — the admin can never supply a VAT number or legal name
// manually; the override always copies the trader's CURRENT
// TraderTaxProfile verbatim.
@Controller("admin/orders")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminBuyerBillingOverrideController {
  constructor(private readonly overrides: MasterOrderBuyerBillingOverrideService) {}

  @Post(":masterOrderId/buyer-billing-override")
  create(
    @Param("masterOrderId") masterOrderId: string,
    @Body() dto: CreateBuyerBillingOverrideDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.overrides.createOverride(masterOrderId, dto.reasonNote, {
      userId: session.adminUserId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }
}
