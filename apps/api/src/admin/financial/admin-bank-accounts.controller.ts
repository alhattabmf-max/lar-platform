import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AdminBankAccountsService } from "./admin-bank-accounts.service";
import { RejectBankAccountDto } from "./dto/reject-bank-account.dto";
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

@Controller("admin/bank-accounts")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminBankAccountsController {
  constructor(private readonly adminBankAccounts: AdminBankAccountsService) {}

  @Get("pending-review")
  listPendingReview() {
    return this.adminBankAccounts.listPendingReview();
  }

  @Post(":id/approve")
  async approve(
    @Param("id") id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.adminBankAccounts.approve(id, session.adminUserId, ctxFrom(req));
    return { status: "VERIFIED" };
  }

  @Post(":id/reject")
  async reject(
    @Param("id") id: string,
    @Body() dto: RejectBankAccountDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.adminBankAccounts.reject(id, dto.reason ?? "No reason provided", session.adminUserId, ctxFrom(req));
    return { status: "REJECTED" };
  }
}
