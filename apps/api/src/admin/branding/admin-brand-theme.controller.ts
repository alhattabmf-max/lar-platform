import { Body, Controller, Get, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { BrandThemeAdminView, BrandThemeColors, BrandThemeDraft } from "@platform/types";
import { BrandThemeService } from "../../branding/brand-theme.service";
import { SaveBrandThemeDto } from "./dto/save-brand-theme.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

/**
 * Admin brand theme controls.
 *
 * `AdminSessionAuthGuard` already implies completed 2FA: the admin
 * session cookie is only ever issued after `2fa/verify` or
 * `2fa/setup/confirm` succeeds, so there is no separate 2FA check to add
 * here — adding one would duplicate an invariant the session already
 * carries.
 *
 * `CsrfGuard` is applied at controller level, covering the three
 * state-changing routes. It is a no-op on the GET, which the CSRF
 * provider exempts by design.
 *
 * No Idempotency-Key: the existing admin settings endpoints
 * (admin/settings/*, admin/branding) do not require one, and these
 * operations are naturally idempotent — saving the same draft twice, or
 * publishing twice, converges on the same state rather than creating a
 * second anything.
 *
 * Deliberately admin-only. There is no trader or supplier route to the
 * theme; they consume the ACTIVE theme through the public
 * `GET /api/v1/branding` like every other visitor.
 */
@Controller("admin/branding/theme")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminBrandThemeController {
  constructor(private readonly theme: BrandThemeService) {}

  @Get()
  get(): Promise<BrandThemeAdminView> {
    return this.theme.getAdminView();
  }

  @Put("draft")
  saveDraft(
    @Body() dto: SaveBrandThemeDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ): Promise<BrandThemeDraft> {
    return this.theme.saveDraft({ ...dto }, ctxFrom(session, req));
  }

  @Post("publish")
  publish(
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ): Promise<BrandThemeColors> {
    return this.theme.publish(ctxFrom(session, req));
  }

  @Post("reset")
  reset(
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ): Promise<BrandThemeColors> {
    return this.theme.reset(ctxFrom(session, req));
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
