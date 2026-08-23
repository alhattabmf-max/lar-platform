import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { SupplierOpportunityDetail, SupplierOpportunitySummary } from "@platform/types";
import { OpportunitiesService } from "./opportunities.service";
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

/**
 * The supplier's own opportunities.
 *
 * EVERY response is one of the closed contracts, produced by the projected
 * reads. The write methods on the service return the FULL row — they need
 * the pinned policy versions to do their work — so each write re-reads
 * through `getOwnedProjected` rather than mapping what it happens to hold.
 * That costs one query and makes it impossible for a raw row to leave here:
 * the mapping is not a step a handler can forget.
 */
@Controller("companies/me/opportunities")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  listMine(@CurrentSession() session: SessionData): Promise<SupplierOpportunitySummary[]> {
    return this.opportunities.listMineProjected(session.companyId);
  }

  @Get(":id")
  get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<SupplierOpportunityDetail> {
    return this.opportunities.getOwnedProjected(id, session.companyId);
  }

  @Post()
  async create(
    @Body() dto: CreateOpportunityDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ): Promise<SupplierOpportunityDetail> {
    const row = await this.opportunities.create(dto, ctxFrom(session, req));
    return this.opportunities.getOwnedProjected(row.id, session.companyId);
  }

  @Patch(":id")
  async update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOpportunityDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ): Promise<SupplierOpportunityDetail> {
    await this.opportunities.update(id, dto, ctxFrom(session, req));
    return this.opportunities.getOwnedProjected(id, session.companyId);
  }

  @Delete(":id")
  async deleteDraft(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    await this.opportunities.deleteDraft(id, ctxFrom(session, req));
    return { status: "deleted" };
  }

  @Post(":id/publish")
  async publish(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ): Promise<SupplierOpportunityDetail> {
    await this.opportunities.publish(id, ctxFrom(session, req));
    return this.opportunities.getOwnedProjected(id, session.companyId);
  }

  @Post(":id/extend")
  async extend(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ): Promise<SupplierOpportunityDetail> {
    await this.opportunities.extend(id, ctxFrom(session, req));
    return this.opportunities.getOwnedProjected(id, session.companyId);
  }
}
