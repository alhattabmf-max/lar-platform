import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { OperationsService } from "./operations.service";
import { RejectSupplierDto } from "./dto/reject-supplier.dto";
import { ReturnSupplierDto } from "./dto/return-supplier.dto";
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

@Controller("admin/operations")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get("pending-suppliers")
  listPendingSuppliers() {
    return this.operations.listPendingSupplierVerifications();
  }

  @Post("suppliers/:companyId/approve")
  async approve(
    @Param("companyId") companyId: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.operations.approveSupplier(companyId, session.adminUserId, ctxFrom(req));
    return { status: "VERIFIED" };
  }

  /**
   * Send the request back with what is missing.
   *
   * A THIRD OUTCOME, and the one that was absent. Without it an
   * administrator faced with a nearly-complete supplier had only
   * "approve" or "reject", and rejection is terminal — so the only
   * safe move was to leave the request sitting.
   */
  @Post("suppliers/:companyId/return")
  async returnForCompletion(
    @Param("companyId") companyId: string,
    @Body() dto: ReturnSupplierDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    await this.operations.returnSupplier(
      companyId,
      session.adminUserId,
      dto.reason,
      ctxFrom(req),
    );
    return { status: "RETURNED_FOR_COMPLETION" };
  }

  @Post("suppliers/:companyId/reject")
  async reject(
    @Param("companyId") companyId: string,
    @Body() dto: RejectSupplierDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.operations.rejectSupplier(
      companyId,
      session.adminUserId,
      dto.reason,
      ctxFrom(req)
    );
    return { status: "REJECTED" };
  }
}
