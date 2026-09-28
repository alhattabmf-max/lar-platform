import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";
import { SupplierVerificationRequestService } from "./supplier-verification-request.service";

/**
 * The supplier's own side of being verified.
 *
 * TWO ROUTES: read where you stand, and ask to be reviewed. There is
 * deliberately no third — a supplier cannot withdraw a request or
 * decide one, and the old `POST /verification/reapply`, which moved a
 * REJECTED company straight back to PENDING with nothing reviewed, is
 * gone. Re-opening a refused application is an administrator's
 * decision.
 */
@Controller("companies/me/verification-request")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class SupplierVerificationRequestController {
  constructor(private readonly requests: SupplierVerificationRequestService) {}

  @Get()
  async view(@CurrentSession() session: SessionData) {
    this.assertSupplier(session);
    return this.requests.viewFor(session.companyId);
  }

  @Post()
  async submit(@CurrentSession() session: SessionData, @Req() req: Request) {
    this.assertSupplier(session);

    await this.requests.submit(session.companyId, session.userId, {
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // The VIEW, not the row: the caller needs to know what state it is
    // in now, and re-deriving that in the browser would be a second
    // answer to a question the server already answers.
    return this.requests.viewFor(session.companyId);
  }

  private assertSupplier(session: SessionData): void {
    if (session.accountType !== "SUPPLIER") {
      throw new ForbiddenException(
        "Only supplier accounts are verified this way",
      );
    }
  }
}
