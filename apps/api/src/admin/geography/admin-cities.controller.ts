import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CitiesService } from "../../geography/cities.service";
import { CreateCityDto } from "../../geography/dto/create-city.dto";
import { UpdateCityDto } from "../../geography/dto/update-city.dto";
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

@Controller("admin/cities")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminCitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get()
  listAll() {
    return this.cities.listAll();
  }

  @Post()
  create(
    @Body() dto: CreateCityDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.cities.create(dto, ctxFrom(req, session));
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateCityDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.cities.update(id, dto, ctxFrom(req, session));
  }

  @Post(":id/toggle")
  toggle(
    @Param("id") id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.cities.toggle(id, ctxFrom(req, session));
  }
}
