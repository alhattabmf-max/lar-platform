import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Env } from "@platform/config";
import type { AdminMe, AdminRecoveryCodesIssued } from "@platform/types";
import { AdminAuthService } from "./admin-auth.service";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { Admin2faSetupDto } from "./dto/admin-2fa-setup.dto";
import { Admin2faSetupConfirmDto } from "./dto/admin-2fa-setup-confirm.dto";
import { Admin2faVerifyDto } from "./dto/admin-2fa-verify.dto";
import { AdminChangePasswordDto } from "./dto/admin-change-password.dto";
import { AdminRecoveryRegenerateDto } from "./dto/admin-recovery-regenerate.dto";
import { APP_ENV } from "../../config/app-config.module";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { AdminSessionAuthGuard, type AdminAuthenticatedRequest } from "./admin-session-auth.guard";
import { CurrentAdminSession } from "./current-admin-session.decorator";
import type { AdminSessionData } from "./admin-session.service";
import { ADMIN_SESSION_COOKIE_NAME } from "./admin-session-cookie.constants";
import {
  buildAdminSessionCookieOptions,
  buildClearAdminSessionCookieOptions,
} from "./admin-session-cookie.util";
import { getRequestId } from "../../common/logger/request-id.util";

function ctxFrom(req: Request) {
  return {
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("admin/auth")
@UseGuards(CsrfGuard)
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    @Inject(APP_ENV) private readonly env: Env
  ) {}

  @Post("login")
  async login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.adminAuth.login(dto.email, dto.password, ctxFrom(req));
  }

  @Post("2fa/setup")
  async setup2fa(@Body() dto: Admin2faSetupDto) {
    return this.adminAuth.begin2faSetup(dto.ticket);
  }

  @Post("2fa/setup/confirm")
  async confirm2faSetup(
    @Body() dto: Admin2faSetupConfirmDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const { sessionId, ttlSeconds } = await this.adminAuth.confirm2faSetup(
      dto.ticket,
      dto.code,
      ctxFrom(req)
    );
    res.cookie(ADMIN_SESSION_COOKIE_NAME, sessionId, buildAdminSessionCookieOptions(this.env, ttlSeconds));
    return { status: "ok" };
  }

  @Post("2fa/verify")
  async verify2fa(
    @Body() dto: Admin2faVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const { sessionId, ttlSeconds } = await this.adminAuth.verify2fa(dto.ticket, ctxFrom(req), {
      code: dto.code,
      recoveryCode: dto.recoveryCode,
    });
    res.cookie(ADMIN_SESSION_COOKIE_NAME, sessionId, buildAdminSessionCookieOptions(this.env, ttlSeconds));
    return { status: "ok" };
  }

  /**
   * Who the caller is.
   *
   * The admin portal's server-side guard rests entirely on this route:
   * a Server Component has no cookie jar and no way to read the admin
   * session otherwise. The response is closed — id, email, status and a
   * 2FA boolean — and re-reads the row rather than trusting the session
   * blob, so an account disabled mid-session stops answering here.
   */
  @Get("me")
  @UseGuards(AdminSessionAuthGuard)
  me(@CurrentAdminSession() session: AdminSessionData): Promise<AdminMe> {
    return this.adminAuth.me(session.adminUserId);
  }

  /**
   * Changes the caller's own password.
   *
   * Behind `AdminSessionAuthGuard`, so the session already completed
   * MFA, and it still requires the current password: a live session is
   * not proof of knowing the credential being replaced.
   */
  @Post("password/change")
  @UseGuards(AdminSessionAuthGuard)
  async changePassword(
    @Body() dto: AdminChangePasswordDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: AdminAuthenticatedRequest
  ) {
    await this.adminAuth.changeOwnPassword(
      session.adminUserId,
      req.adminSessionId,
      dto.currentPassword,
      dto.newPassword,
      ctxFrom(req)
    );
    return { status: "ok" };
  }

  /**
   * Replaces the caller's recovery codes.
   *
   * The plaintext comes back EXACTLY ONCE and is stored nowhere — only
   * hashes are written — so a client that discards this response cannot
   * recover it.
   */
  @Post("recovery-codes/regenerate")
  @UseGuards(AdminSessionAuthGuard)
  regenerateRecoveryCodes(
    @Body() dto: AdminRecoveryRegenerateDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ): Promise<AdminRecoveryCodesIssued> {
    return this.adminAuth.regenerateOwnRecoveryCodes(
      session.adminUserId,
      dto.currentPassword,
      ctxFrom(req)
    );
  }

  @Post("logout")
  @UseGuards(AdminSessionAuthGuard)
  async logout(
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: AdminAuthenticatedRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    await this.adminAuth.logout(req.adminSessionId, session.adminUserId, ctxFrom(req));
    res.clearCookie(ADMIN_SESSION_COOKIE_NAME, buildClearAdminSessionCookieOptions(this.env));
    return { status: "ok" };
  }
}
