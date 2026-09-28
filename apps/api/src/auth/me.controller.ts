import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { ChangeEmailDto } from "./dto/change-email.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { ctxFrom } from "./request-context";

@Controller()
@UseGuards(SessionAuthGuard)
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get("me")
  async me(@CurrentSession() session: SessionData) {
    const user = await this.auth.getMe(session.userId);
    return {
      userId: user.id,
      email: user.email,
      emailVerificationStatus: user.emailVerificationStatus,
      role: user.role,
      status: user.status,
      company: {
        id: user.company.id,
        crNumber: user.company.crNumber,
        legalName: user.company.legalName,
        accountType: user.company.accountType,
        verificationStatus: user.company.verificationStatus,
      },
      profile: user.profile,
    };
  }

  /**
   * THE ADDRESS THIS COMPANY IS REACHED ON.
   *
   * On «بيانات المنشأة» the email used to be shown and nothing else —
   * an account created with a typo had no way to correct it short of
   * an administrator. The new address is UNVERIFIED whatever the old
   * one was: proving control of one mailbox says nothing about
   * another, and the response says which status it now holds so the
   * portal can show it without a second read.
   */
  @Put("me/email")
  async changeEmail(
    @CurrentSession() session: SessionData,
    @Body() dto: ChangeEmailDto,
    @Req() req: Request,
  ) {
    return this.auth.changeEmail(session.userId, dto.email, ctxFrom(req));
  }
}
