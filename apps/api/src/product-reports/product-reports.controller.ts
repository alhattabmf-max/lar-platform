import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ProductReportsService } from "./product-reports.service";
import { CreateProductReportDto } from "./dto/create-product-report.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";
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

@Controller("trader/product-reports")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class ProductReportsController {
  constructor(private readonly reports: ProductReportsService) {}

  @Post()
  create(@Body() dto: CreateProductReportDto, @CurrentSession() session: SessionData, @Req() req: Request) {
    return this.reports.create(dto, ctxFrom(session, req));
  }

  @Get("mine")
  listMine(@CurrentSession() session: SessionData) {
    return this.reports.listMine(session.companyId);
  }
}
