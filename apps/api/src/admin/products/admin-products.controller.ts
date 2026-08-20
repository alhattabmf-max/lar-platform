import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AdminProductsService } from "./admin-products.service";
import { RejectProductDto } from "./dto/reject-product.dto";
import { ProductAdministrativeActionDto } from "./dto/product-administrative-action.dto";
import { ProductReportsService } from "../../product-reports/product-reports.service";
import { DecideProductReportDto } from "../../product-reports/dto/decide-product-report.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

function ctxFrom(req: Request) {
  return {
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

function reportCtxFrom(req: Request, session: AdminSessionData) {
  return { ...ctxFrom(req), actorId: session.adminUserId };
}

@Controller("admin/products")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminProductsController {
  constructor(
    private readonly adminProducts: AdminProductsService,
    private readonly reports: ProductReportsService
  ) {}

  @Get("pending-review")
  listPendingReview() {
    return this.adminProducts.listPendingReview();
  }

  @Post(":id/approve")
  async approve(
    @Param("id") id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.adminProducts.approve(id, session.adminUserId, ctxFrom(req));
    return { status: "APPROVED" };
  }

  @Post(":id/reject")
  async reject(
    @Param("id") id: string,
    @Body() dto: RejectProductDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.adminProducts.reject(id, dto.reason ?? "No reason provided", session.adminUserId, ctxFrom(req));
    return { status: "REJECTED" };
  }

  @Post(":id/suspend")
  suspend(
    @Param("id") id: string,
    @Body() dto: ProductAdministrativeActionDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.adminProducts.suspend(id, dto.reason, session.adminUserId, ctxFrom(req));
  }

  @Post(":id/close")
  close(
    @Param("id") id: string,
    @Body() dto: ProductAdministrativeActionDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.adminProducts.close(id, dto.reason, session.adminUserId, ctxFrom(req));
  }

  @Post(":id/reactivate")
  reactivate(
    @Param("id") id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.adminProducts.reactivate(id, session.adminUserId, ctxFrom(req));
  }

  @Get("reports")
  listReports(@Query("status") status?: "OPEN" | "CLARIFICATION_REQUESTED" | "DISMISSED" | "RESOLVED") {
    return this.reports.listForAdmin(status);
  }

  @Get("reports/:reportId")
  getReport(@Param("reportId") reportId: string) {
    return this.reports.getForAdmin(reportId);
  }

  @Post("reports/:reportId/request-clarification")
  requestClarification(
    @Param("reportId") reportId: string,
    @Body() dto: DecideProductReportDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.reports.requestClarification(reportId, dto.note, session.adminUserId, reportCtxFrom(req, session));
  }

  @Post("reports/:reportId/dismiss")
  dismiss(
    @Param("reportId") reportId: string,
    @Body() dto: DecideProductReportDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.reports.dismiss(reportId, dto.note, session.adminUserId, reportCtxFrom(req, session));
  }

  @Post("reports/:reportId/resolve")
  resolve(
    @Param("reportId") reportId: string,
    @Body() dto: DecideProductReportDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.reports.resolve(reportId, dto.note, session.adminUserId, reportCtxFrom(req, session));
  }
}
