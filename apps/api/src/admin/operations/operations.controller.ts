import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { OperationsService } from "./operations.service";
import { RejectSupplierDto } from "./dto/reject-supplier.dto";
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
      dto.reason ?? "No reason provided",
      ctxFrom(req)
    );
    return { status: "REJECTED" };
  }
}
