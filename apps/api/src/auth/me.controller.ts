import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

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
    };
  }
}
