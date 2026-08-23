import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Query, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { DisputeService } from "./dispute.service";
import type {
  Paginated,
  SupplierDisputeDetailView,
  SupplierDisputeSummary,
} from "@platform/types";
import { TraderPageQueryDto } from "../orders/dto/trader-page-query.dto";
import { SupplierRespondDto } from "./dto/supplier-respond.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
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

@Controller("supplier/disputes")
@UseGuards(SessionAuthGuard, RequireSupplierGuard, CsrfGuard)
export class SupplierDisputeController {
  constructor(private readonly disputes: DisputeService) {}

  /**
   * Every dispute raised against this supplier, newest first.
   *
   * Ordered by `openedAt desc, id asc` — NOT awaiting-response first. Each
   * summary carries `awaitingSupplierResponse`, so a caller can find the ones
   * that need a reply without the list ordering having to encode it.
   *
   * Until 8E there was no list at all: a dispute could only be reached from
   * the notification that announced it, so one missed notification meant a
   * dispute the supplier never saw and a response deadline they never met.
   */
  @Get()
  list(
    @Query() query: TraderPageQueryDto,
    @CurrentSession() session: SessionData
  ): Promise<Paginated<SupplierDisputeSummary>> {
    return this.disputes.listForSupplier(session.companyId, query);
  }

  /**
   * Returns the closed `SupplierDisputeDetailView`.
   *
   * No storage key, no uploader, no administrator's note, and no evidence
   * uploaded by the TRADER — filtered in SQL rather than after the read.
   */
  @Get(":id")
  get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<SupplierDisputeDetailView> {
    return this.disputes.getForSupplier(id, session.companyId);
  }

  @Post(":id/respond")
  respond(
    @Param("id") id: string,
    @Body() dto: SupplierRespondDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required");
    return this.disputes.supplierRespondIdempotent(id, dto, ctxFrom(session, req), idempotencyKey);
  }
}
