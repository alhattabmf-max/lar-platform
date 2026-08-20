import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { RegionsService } from "../../geography/regions.service";
import { CreateRegionDto } from "../../geography/dto/create-region.dto";
import { UpdateRegionDto } from "../../geography/dto/update-region.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

function ctxFrom(req: Request, session: AdminSessionData) {
  return {
    actorId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("admin/regions")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminRegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Get()
  listAll() {
    return this.regions.listAll();
  }

  @Post()
  create(
    @Body() dto: CreateRegionDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.regions.create(dto, ctxFrom(req, session));
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateRegionDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.regions.update(id, dto, ctxFrom(req, session));
  }

  @Post(":id/toggle")
  toggle(
    @Param("id") id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.regions.toggle(id, ctxFrom(req, session));
  }
}
