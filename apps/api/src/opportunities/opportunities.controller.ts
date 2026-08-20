import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { OpportunitiesService, toSupplierOpportunityView } from "./opportunities.service";
import { CreateOpportunityDto } from "./dto/create-opportunity.dto";
import { UpdateOpportunityDto } from "./dto/update-opportunity.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";

function ctxFrom(session: SessionData, req: Request) {
  return {
    userId: session.userId,
    companyId: session.companyId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("companies/me/opportunities")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  async listMine(@CurrentSession() session: SessionData) {
    const rows = await this.opportunities.listMine(session.companyId);
    return rows.map(toSupplierOpportunityView);
  }

  @Get(":id")
  async get(@Param("id") id: string, @CurrentSession() session: SessionData) {
    const row = await this.opportunities.getOwned(id, session.companyId);
    return toSupplierOpportunityView(row);
  }

  @Post()
  async create(
    @Body() dto: CreateOpportunityDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    const row = await this.opportunities.create(dto, ctxFrom(session, req));
    return toSupplierOpportunityView(row);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateOpportunityDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    const row = await this.opportunities.update(id, dto, ctxFrom(session, req));
    return toSupplierOpportunityView(row);
  }

  @Delete(":id")
  async deleteDraft(
    @Param("id") id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    await this.opportunities.deleteDraft(id, ctxFrom(session, req));
    return { status: "deleted" };
  }

  @Post(":id/publish")
  async publish(
    @Param("id") id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    const row = await this.opportunities.publish(id, ctxFrom(session, req));
    return toSupplierOpportunityView(row);
  }

  @Post(":id/extend")
  async extend(
    @Param("id") id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    const row = await this.opportunities.extend(id, ctxFrom(session, req));
    return toSupplierOpportunityView(row);
  }
}
