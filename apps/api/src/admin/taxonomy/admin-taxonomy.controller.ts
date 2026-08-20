import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { TaxonomyService } from "../../taxonomy/taxonomy.service";
import { CreateTaxonomyNodeDto } from "../../taxonomy/dto/create-taxonomy-node.dto";
import { UpdateTaxonomyNodeDto } from "../../taxonomy/dto/update-taxonomy-node.dto";
import { MoveTaxonomyNodeDto } from "../../taxonomy/dto/move-taxonomy-node.dto";
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

@Controller("admin/taxonomy")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminTaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  listAll() {
    return this.taxonomy.listAll();
  }

  @Post()
  create(
    @Body() dto: CreateTaxonomyNodeDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.taxonomy.create(dto, ctxFrom(req, session));
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateTaxonomyNodeDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.taxonomy.update(id, dto, ctxFrom(req, session));
  }

  @Post(":id/move")
  move(
    @Param("id") id: string,
    @Body() dto: MoveTaxonomyNodeDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.taxonomy.move(id, dto.newParentId, ctxFrom(req, session));
  }

  @Post(":id/toggle")
  toggle(
    @Param("id") id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.taxonomy.toggle(id, ctxFrom(req, session));
  }
}
