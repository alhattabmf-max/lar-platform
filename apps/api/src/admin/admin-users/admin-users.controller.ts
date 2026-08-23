import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { AdminUserItem, Paginated } from "@platform/types";
import { AdminUsersService } from "./admin-users.service";
import { AdminUsersQueryDto } from "./dto/admin-users-query.dto";
import { AdminReasonDto } from "./dto/admin-reason.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { getRequestId } from "../../common/logger/request-id.util";

function ctxFrom(req: Request, session: AdminSessionData) {
  return {
    actorId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

/**
 * Administrator accounts.
 *
 * NO CREATE ROUTE, by design. A new administrator comes from the
 * operational CLI and nowhere else — an HTTP create behind the admin
 * guard would turn one compromised session into the ability to mint more
 * administrators.
 *
 * Every write takes a REASON. These are actions one operator takes
 * against another's access, and "who did this and why" is the whole
 * point of the audit record.
 */
@Controller("admin/admin-users")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  list(@Query() query: AdminUsersQueryDto): Promise<Paginated<AdminUserItem>> {
    return this.adminUsers.list(query);
  }

  @Post(":id/disable")
  async disable(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: AdminReasonDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.adminUsers.disable(id, dto.reason, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Post(":id/enable")
  async enable(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: AdminReasonDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.adminUsers.enable(id, dto.reason, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Post(":id/reset-2fa")
  async resetTwoFactor(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: AdminReasonDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.adminUsers.resetTwoFactor(id, dto.reason, ctxFrom(req, session));
    return { status: "ok" };
  }
}
