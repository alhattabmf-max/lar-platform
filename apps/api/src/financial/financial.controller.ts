import { Body, Controller, Get, Put, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { BankAccountsService } from "./bank-accounts.service";
import { TaxProfileService } from "./tax-profile.service";
import { InvoicingProfileService } from "./invoicing-profile.service";
import { FinancialReadinessService } from "./financial-readiness.service";
import { SubmitBankAccountDto } from "./dto/submit-bank-account.dto";
import { UpdateTaxProfileDto } from "./dto/update-tax-profile.dto";
import { UpdateInvoicingProfileDto } from "./dto/update-invoicing-profile.dto";
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

@Controller("companies/me")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class FinancialController {
  constructor(
    private readonly bankAccounts: BankAccountsService,
    private readonly taxProfile: TaxProfileService,
    private readonly invoicingProfile: InvoicingProfileService,
    private readonly readiness: FinancialReadinessService
  ) {}

  @Get("bank-account")
  listBankAccounts(@CurrentSession() session: SessionData) {
    return this.bankAccounts.listMine(session.companyId);
  }

  @Post("bank-account")
  submitBankAccount(
    @Body() dto: SubmitBankAccountDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.bankAccounts.submit(dto, ctxFrom(session, req));
  }

  @Get("tax-profile")
  getTaxProfile(@CurrentSession() session: SessionData) {
    return this.taxProfile.get(session.companyId);
  }

  @Put("tax-profile")
  setTaxProfile(
    @Body() dto: UpdateTaxProfileDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.taxProfile.upsert(dto, ctxFrom(session, req));
  }

  @Get("invoicing-profile")
  getInvoicingProfile(@CurrentSession() session: SessionData) {
    return this.invoicingProfile.get(session.companyId);
  }

  @Put("invoicing-profile")
  setInvoicingProfile(
    @Body() dto: UpdateInvoicingProfileDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.invoicingProfile.upsert(dto, ctxFrom(session, req));
  }

  @Get("financial-readiness")
  getFinancialReadiness(@CurrentSession() session: SessionData) {
    return this.readiness.check(session.companyId);
  }
}
