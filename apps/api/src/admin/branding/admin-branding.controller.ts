import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AdminBrandingService } from "./admin-branding.service";
import { UpdateBrandingDto } from "./dto/update-branding.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

@Controller("admin/branding")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminBrandingController {
  constructor(private readonly branding: AdminBrandingService) {}

  @Get()
  get() {
    return this.branding.get();
  }

  @Put()
  update(
    @Body() dto: UpdateBrandingDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.branding.update(dto, {
      actorId: session.adminUserId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }
}
