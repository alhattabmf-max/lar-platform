import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { SupplierOpportunityDetail, SupplierOpportunitySummary } from "@platform/types";
import { OpportunitiesService } from "./opportunities.service";
import { CreateOpportunityDto } from "./dto/create-opportunity.dto";
import { UpdateOpportunityDto } from "./dto/update-opportunity.dto";
import { SetDirectStockDto } from "./dto/set-direct-stock.dto";
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

  /**
   * CLOSE AT WHAT IT REACHED — the supplier's other answer inside his
   * twenty-four hours.
   *
   * «إذا قرر أن تقفل الصفقة ويعتمدها أوك، وإذا أراد أن تكتمل مئة
   *  بالمئة فعنده خيار التمديد.» Two routes, one window, and the
   * decision is taken on the offer's own screen — «يقرر المورد في
   * العرض نفسه».
   *
   * NO BODY. There is nothing to say: the quantity is whatever was
   * bought, and the only question was whether to take it.
   */
  @Post(":id/close-at-reached")
  async closeAtReached(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ): Promise<SupplierOpportunityDetail> {
    await this.opportunities.closeAtReached(id, ctxFrom(session, req));
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

  /**
   * RESTOCK, OR TAKE STOCK OFF THE SHELF — a DIRECT listing only.
   *
   * SEPARATE FROM `PATCH :id`, and deliberately. That route refuses
   * every edit once a buyer has committed, because price, branch and
   * preparation days are what a buyer was shown. Stock is the opposite:
   * it changes BECAUSE units were sold, and it changes nothing anyone
   * already agreed to. The floor it may not cross is computed under the
   * offer's own row lock — see `setDirectStock`.
   *
   * It answers with the listing AND what is actually available on it,
   * which is the number the supplier's screen was asking about.
   */
  @Post(":id/stock")
  async setStock(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SetDirectStockDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.opportunities.setDirectStock(id, dto, ctxFrom(session, req));
  }

  /**
   * STOP SELLING — a DIRECT listing only.
   *
   * «يوقف المورد النشرة وينشئ واحدة جديدة بالسعر الجديد.» This is how a
   * price changes on a listing that has sales: it does not. The terms of
   * a sale that already happened are frozen on the row every order,
   * invoice and settlement points back at, so the supplier ends this
   * listing and publishes another.
   *
   * NOBODY IS REFUNDED. Every paid order on a direct listing went to
   * preparation when it was paid and is unaffected. Open baskets are
   * released, exactly as any cancellation releases them.
   */
  @Post(":id/stop")
  async stop(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ): Promise<SupplierOpportunityDetail> {
    return this.opportunities.stopDirect(id, ctxFrom(session, req));
  }
}
