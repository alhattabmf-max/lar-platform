import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AdminOpportunitiesService } from "./admin-opportunities.service";
import { ListAdminOpportunitiesQueryDto } from "./dto/list-admin-opportunities-query.dto";
import { PauseOpportunityDto } from "./dto/pause-opportunity.dto";
import { CancelOpportunityDto } from "./dto/cancel-opportunity.dto";
import { OptionalReasonDto } from "../products/dto/optional-reason.dto";
import { UpdateOpportunityDto } from "../../opportunities/dto/update-opportunity.dto";
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

  /**
   * STOP IT AND GIVE THE MONEY BACK — the owner's own button.
   *
   * «الإدارة توقف العرض ويكون عندها زر استرداد الأموال، عند الضغط يكون
   *  مثل أن فرصة انتهت ولم تكتمل — بس يدوي، قبل أن تنتهي مدة العرض.»
   *
   * SEPARATE FROM `cancel`, NOT A FLAG ON IT. Moving buyers' money is
   * not a variation of stopping an offer; it is a different act with a
   * different consequence, and it should be impossible to perform by
   * forgetting to set something. A plain cancel now refuses outright
   * when anyone has paid, and names this route in the refusal.
   */
  @Post(":id/cancel-and-refund")
  cancelAndRefund(
    @Param("id") id: string,
    @Body() dto: CancelOpportunityDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.opportunities.cancelAndRefund(id, dto.reason, ctxFrom(req, session));
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

  /**
   * «حذف وتعديل العرض من صفحة الإدارة، دام المشتري ما بعد دفع.»
   *
   * The console could pause, resume, cancel and refund — four ways
   * to STOP an offer and not one way to CORRECT or REMOVE it. These
   * two are that, under the same rule the supplier's own routes
   * answer to.
   */
  @Patch(":id")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOpportunityDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.opportunities.update(id, dto, ctxFrom(req, session));
  }

  @Delete(":id")
  remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: OptionalReasonDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.opportunities.deletePermanently(id, dto.reason, ctxFrom(req, session));
  }
}
