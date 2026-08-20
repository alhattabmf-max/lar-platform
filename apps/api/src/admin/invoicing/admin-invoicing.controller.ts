import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { InvoiceService } from "../../invoicing/invoice.service";
import { PlatformBillingProfileService } from "../../invoicing/platform-billing-profile.service";
import { CreateAdjustmentDto } from "../../invoicing/dto/create-adjustment.dto";
import { CreatePlatformBillingProfileDto } from "../../invoicing/dto/create-platform-billing-profile.dto";
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

// Admin-only, 2FA via AdminSessionAuthGuard's session requirement.
// There is no supplier- or trader-facing endpoint anywhere in the API
// that can create or view these documents — by design.
@Controller()
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminInvoicingController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly platformBillingProfile: PlatformBillingProfileService
  ) {}

  @Get("admin/orders/:masterOrderId/invoice-drafts")
  list(@Param("masterOrderId") masterOrderId: string) {
    return this.invoices.list(masterOrderId);
  }

  @Post("admin/orders/:masterOrderId/invoice-drafts/product")
  createProductDraft(
    @Param("masterOrderId") masterOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required");
    return this.invoices.createProductDraft(masterOrderId, ctxFrom(session, req), idempotencyKey);
  }

  @Post("admin/orders/:masterOrderId/invoice-drafts/commission")
  createCommissionDraft(
    @Param("masterOrderId") masterOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required");
    return this.invoices.createCommissionDraft(masterOrderId, ctxFrom(session, req), idempotencyKey);
  }

  @Post("admin/invoice-drafts/:id/adjustments")
  createAdjustment(
    @Param("id") id: string,
    @Body() dto: CreateAdjustmentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required");
    return this.invoices.createAdjustment(id, dto, ctxFrom(session, req), idempotencyKey);
  }

  @Get("admin/platform-billing-profile")
  getPlatformBillingProfile() {
    return this.platformBillingProfile.getCurrent();
  }

  @Post("admin/platform-billing-profile")
  createPlatformBillingProfileVersion(
    @Body() dto: CreatePlatformBillingProfileDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.platformBillingProfile.createNewVersion(dto, ctxFrom(session, req));
  }
}
