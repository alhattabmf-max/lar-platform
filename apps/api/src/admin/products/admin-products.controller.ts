import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AdminProductsService } from "./admin-products.service";
import { RejectProductDto } from "./dto/reject-product.dto";
import { ProductAdministrativeActionDto } from "./dto/product-administrative-action.dto";
import { OptionalReasonDto } from "./dto/optional-reason.dto";
import { AdminUpdateProductDto } from "./dto/admin-update-product.dto";
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
    await this.adminProducts.reject(id, dto.reason, session.adminUserId, ctxFrom(req));
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

  /**
   * PERMANENT, AND IT SAYS SO IN THE VERB. `DELETE` is the only method
   * a reader of this file can mistake for nothing else; the four
   * neighbouring actions are all `POST` because they CHANGE a product
   * that goes on existing.
   *
   * IT TAKES A REASON like every other administrative action here. A
   * row that is about to stop existing is the one case where the note
   * in the audit log is all that will be left.
   */
  @Delete(":id")
  deletePermanently(
    @Param("id") id: string,
    // NO REASON DEMANDED — «بدون أن يطلب مني سبب». The body may carry
    // one and the audit entry keeps it; an empty body is accepted.
    @Body() dto: OptionalReasonDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.adminProducts.deletePermanently(
      id,
      dto?.reason,
      session.adminUserId,
      ctxFrom(req)
    );
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

  /**
   * ONE PRODUCT, READ.
   *
   * DECLARED LAST ON PURPOSE. Nest matches routes in declaration order,
   * and `:id` matches the literal word "reports" as happily as it matches
   * a uuid — so every static path on this controller must be registered
   * before it. Moving this method up the file would silently turn
   * `GET /admin/products/reports` into a lookup for a product named
   * "reports", which 404s rather than failing loudly.
   */
  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.adminProducts.getOne(id);
  }

  /**
   * ONE PRODUCT, EDITED — «تعديل بصلاحية كاملة، مسجَّل في التدقيق».
   *
   * PATCH, not PUT: every field is optional, and omitting one means
   * leaving it alone rather than clearing it. A PUT would promise that
   * the body is the whole record, and a form that forgot a field would
   * erase it.
   *
   * The neighbouring routes are all POST because each is one named ACT
   * on a product — approve, suspend, close — with its own cascade. This
   * one is not an act; it writes fields.
   */
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: AdminUpdateProductDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.adminProducts.updateAsAdmin(id, dto, session.adminUserId, ctxFrom(req));
  }
}
