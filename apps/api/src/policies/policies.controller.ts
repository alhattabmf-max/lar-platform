import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { IsArray, IsUUID } from "class-validator";
import { PoliciesService } from "./policies.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";

class AcceptPoliciesDto {
  @IsArray()
  @IsUUID("4", { each: true })
  policyVersionIds!: string[];
}

@Controller("policies")
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get("active")
  async active() {
    return this.policies.getActivePolicyVersions();
  }

  @Post("accept")
  @UseGuards(SessionAuthGuard, CsrfGuard)
  async accept(
    @Body() dto: AcceptPoliciesDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ): Promise<{ accepted: number }> {
    await this.policies.recordAcceptances(dto.policyVersionIds, {
      companyId: session.companyId,
      userId: session.userId,
      accountType: session.accountType,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return { accepted: dto.policyVersionIds.length };
  }
}
