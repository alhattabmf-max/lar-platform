import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SalesUnitsService } from "../../sales-units/sales-units.service";
import { CreateSalesUnitDto } from "../../sales-units/dto/create-sales-unit.dto";
import { UpdateSalesUnitDto } from "../../sales-units/dto/update-sales-unit.dto";
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

@Controller("admin/sales-units")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminSalesUnitsController {
  constructor(private readonly salesUnits: SalesUnitsService) {}

  @Get()
  listAll() {
    return this.salesUnits.listAll();
  }

  @Post()
  create(
    @Body() dto: CreateSalesUnitDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.salesUnits.create(dto, ctxFrom(req, session));
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateSalesUnitDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.salesUnits.update(id, dto, ctxFrom(req, session));
  }

  @Post(":id/toggle")
  toggle(
    @Param("id") id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.salesUnits.toggle(id, ctxFrom(req, session));
  }
}
