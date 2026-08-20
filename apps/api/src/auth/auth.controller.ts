import { Body, Controller, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import type { Env } from "@platform/config";
import { AuthService } from "./auth.service";
import { RegisterCompanyDto } from "./dto/register-company.dto";
import { LoginDto } from "./dto/login.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { APP_ENV } from "../config/app-config.module";
import { CsrfGuard } from "../common/security/csrf.guard";
import { SessionAuthGuard, type AuthenticatedRequest } from "../common/security/session-auth.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { SESSION_COOKIE_NAME } from "../common/security/session-cookie.constants";
import { buildClearSessionCookieOptions, buildSessionCookieOptions } from "../common/security/session-cookie.util";
import { getRequestId } from "../common/logger/request-id.util";

function ctxFrom(req: Request) {
  return {
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("auth")
@UseGuards(CsrfGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_ENV) private readonly env: Env
  ) {}

  @Post("register/trader")
  registerTrader(@Body() dto: RegisterCompanyDto, @Req() req: Request) {
    return this.auth.registerTrader(dto, ctxFrom(req));
  }

  @Post("register/supplier")
  registerSupplier(@Body() dto: RegisterCompanyDto, @Req() req: Request) {
    return this.auth.registerSupplier(dto, ctxFrom(req));
  }

  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.auth.login(dto.crNumber, dto.password, ctxFrom(req));
    res.cookie(SESSION_COOKIE_NAME, result.sessionId, buildSessionCookieOptions(this.env));
    return { companyId: result.companyId, accountType: result.accountType };
  }

  @Post("logout")
  @UseGuards(SessionAuthGuard)
  async logout(
    @CurrentSession() session: SessionData,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    await this.auth.logout(req.sessionId, session.userId, session.companyId, ctxFrom(req));
    res.clearCookie(SESSION_COOKIE_NAME, buildClearSessionCookieOptions(this.env));
    return { status: "ok" };
  }

  @Post("password/forgot")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto.email, ctxFrom(req));
    // Identical response whether or not the email exists — enumeration protection.
    return { status: "ok" };
  }

  @Post("password/reset")
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.auth.resetPassword(dto.token, dto.newPassword, ctxFrom(req));
    return { status: "ok" };
  }

  @Post("email/verify")
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    await this.auth.verifyEmail(dto.token, ctxFrom(req));
    return { status: "ok" };
  }

  @Post("email/resend-verification")
  @UseGuards(SessionAuthGuard)
  async resendVerification(@CurrentSession() session: SessionData, @Req() req: Request) {
    await this.auth.resendVerificationEmail(session.userId, ctxFrom(req));
    return { status: "ok" };
  }
}
