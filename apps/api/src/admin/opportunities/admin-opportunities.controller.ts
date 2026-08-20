import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AdminOpportunitiesService } from "./admin-opportunities.service";
import { ListAdminOpportunitiesQueryDto } from "./dto/list-admin-opportunities-query.dto";
import { PauseOpportunityDto } from "./dto/pause-opportunity.dto";
import { CancelOpportunityDto } from "./dto/cancel-opportunity.dto";
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

@Controller("admin/opportunities")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminOpportunitiesController {
  constructor(private readonly opportunities: AdminOpportunitiesService) {}

  @Get()
  list(@Query() query: ListAdminOpportunitiesQueryDto) {
    return this.opportunities.list(query);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.opportunities.getById(id);
  }

  @Post(":id/pause")
  pause(
    @Param("id") id: string,
    @Body() dto: PauseOpportunityDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.opportunities.pause(id, dto.reason, ctxFrom(req, session));
  }

  @Post(":id/resume")
  resume(
    @Param("id") id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.opportunities.resume(id, ctxFrom(req, session));
  }

  @Post(":id/cancel")
  cancel(
    @Param("id") id: string,
    @Body() dto: CancelOpportunityDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.opportunities.cancel(id, dto.reason, ctxFrom(req, session));
  }
}
