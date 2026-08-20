import { Controller, ForbiddenException, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { VerificationService } from "./verification.service";
import { getRequestId } from "../common/logger/request-id.util";

@Controller("verification")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post("reapply")
  async reapply(@CurrentSession() session: SessionData, @Req() req: Request): Promise<{ status: string }> {
    if (session.accountType !== "SUPPLIER") {
      throw new ForbiddenException("Only supplier accounts can reapply for verification");
    }

    await this.verification.reapply(session.companyId, session.userId, {
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return { status: "PENDING_VERIFICATION" };
  }
}
