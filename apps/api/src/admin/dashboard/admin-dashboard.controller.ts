import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { FollowUpCaseKind } from "@prisma/client";
import type {
  AdminOrderRow,
  AdminOrderStageInsight,
  DashboardOverview,
  FollowUpBoard,
  Paginated,
} from "@platform/types";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";
import {
  AdminExportService,
  EXPORT_ROW_CEILING,
} from "../exports/admin-export.service";
import { DashboardService } from "./dashboard.service";
import { AdminOrdersService } from "./admin-orders.service";
import { FollowUpService } from "./follow-up.service";
import {
  AssignFollowUpDto,
  DashboardQueryDto,
  FollowUpExportQueryDto,
  FollowUpQueryDto,
  OrdersQueryDto,
  SetInProgressDto,
} from "./dto/dashboard-query.dto";

/**
 * The three screens the overview decision covers.
 *
 * EVERY ROUTE IS BEHIND THE ADMIN SESSION GUARD, at the controller
 * level, so a route added later cannot be forgotten. These reads carry
 * the platform's whole financial position — what it took, what it owes,
 * what it refunded — and none of it may be reachable without a session.
 *
 * The two writes carry `CsrfGuard` as well; the reads do not need it
 * and the provider exempts safe methods anyway.
 */
@Controller("admin")
@UseGuards(AdminSessionAuthGuard)
export class AdminDashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly orders: AdminOrdersService,
    private readonly followUp: FollowUpService,
    private readonly exports: AdminExportService,
  ) {}

  /** Everything the overview shows, in one read rather than six lists. */
  @Get("dashboard/overview")
  overview(@Query() query: DashboardQueryDto): Promise<DashboardOverview> {
    return this.dashboard.overview(query.resolvedPeriod());
  }

  /** The four stages, and what each one costs in time. */
  @Get("orders/insights")
  insights(@Query() query: DashboardQueryDto): Promise<AdminOrderStageInsight> {
    return this.orders.insights(query.resolvedPeriod());
  }

  /** The rows beneath those stages. */
  @Get("orders/list")
  list(@Query() query: OrdersQueryDto): Promise<Paginated<AdminOrderRow>> {
    return this.orders.list({
      period: query.resolvedPeriod(),
      stage: query.stage,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get("follow-up")
  board(@Query() query: FollowUpQueryDto): Promise<FollowUpBoard> {
    return this.followUp.board({
      period: query.resolvedPeriod(),
      search: query.search,
      priority: query.priority,
      kind: query.kind,
      assignee: query.assignee,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /**
   * The follow-up list as a file.
   *
   * THE SAME FILTERS THE SCREEN HAS, so the file matches what the
   * operator was looking at. No amount and no party detail leaves here
   * that the table does not already show.
   */
  @Get("follow-up/export")
  async exportBoard(
    @Query() query: FollowUpExportQueryDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const board = await this.followUp.board({
      period: query.resolvedPeriod(),
      search: query.search,
      priority: query.priority,
      kind: query.kind,
      assignee: query.assignee,
      page: 1,
      pageSize: EXPORT_ROW_CEILING,
    });

    await this.exports.send(res, {
      kind: "follow-up",
      columns: [
        { header: query.c1 ?? "case", width: 26 },
        { header: query.c2 ?? "priority", width: 14 },
        { header: query.c3 ?? "subject", width: 34 },
        { header: query.c4 ?? "ageHours", width: 12 },
        { header: query.c5 ?? "assignee", width: 28 },
        { header: query.c6 ?? "inProgress", width: 14 },
      ],
      rows: board.cases.map((row) => [
        query.actionLabel(row.kind) ?? row.kind,
        query.statusLabel(row.priority) ?? row.priority,
        row.subject,
        row.ageHours,
        row.assigneeName ?? "",
        row.inProgress
          ? (query.passwordSet ?? "yes")
          : (query.passwordPending ?? "no"),
      ]),
      fileLabel: query.fileLabel ?? "follow-up",
      datePart: query.safeDate(),
      truncated: board.total > board.cases.length,
      filters: {
        priority: query.priority ?? null,
        kind: query.kind ?? null,
        assignee: query.assignee ?? null,
        search: query.search ?? null,
      },
      actorId: session.adminUserId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  /**
   * Puts a case on somebody, or takes it off.
   *
   * THIS DOES NOT CLOSE THE CASE. Nothing on this route can: the case
   * is derived from the record it is about, and leaves the list only
   * when that record changes.
   */
  @Post("follow-up/:kind/:caseRef/assign")
  @UseGuards(CsrfGuard)
  assign(
    @Param("kind") kind: string,
    @Param("caseRef") caseRef: string,
    @Body() dto: AssignFollowUpDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.followUp.assign(
      kind as FollowUpCaseKind,
      caseRef,
      dto.assigneeId ?? null,
      ctxFrom(session, req),
    );
  }

  @Post("follow-up/:kind/:caseRef/in-progress")
  @UseGuards(CsrfGuard)
  setInProgress(
    @Param("kind") kind: string,
    @Param("caseRef") caseRef: string,
    @Body() dto: SetInProgressDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.followUp.setInProgress(
      kind as FollowUpCaseKind,
      caseRef,
      dto.inProgress,
      ctxFrom(session, req),
    );
  }
}

function ctxFrom(session: AdminSessionData, req: Request) {
  return {
    actorId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}
