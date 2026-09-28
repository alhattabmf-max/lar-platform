import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { FooterConfig } from "@platform/types";
import {
  FooterService,
  type FooterAdminView,
} from "../../branding/footer.service";
import { SaveFooterDto, footerConfigFromDto } from "./dto/save-footer.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

/**
 * Footer management.
 *
 * Guards, idempotency and reasoning follow `AdminBrandThemeController`
 * exactly — the same draft/publish shape deserves the same handling,
 * and an operator who has published a theme should find nothing new
 * here. `AdminSessionAuthGuard` already implies completed 2FA;
 * `CsrfGuard` covers the state-changing routes and is a no-op on the
 * GET.
 *
 * NO SECOND FACTOR ON TOP. Changing which links appear in the footer is
 * a content decision, recorded with its before and after like every
 * other one. Asking for a code to reorder two links teaches people to
 * keep the authenticator open, which is the habit that makes the code
 * worthless where it matters.
 */
@Controller("admin/branding/footer")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminFooterController {
  constructor(private readonly footer: FooterService) {}

  @Get()
  get(): Promise<FooterAdminView> {
    return this.footer.getAdminView();
  }

  @Put("draft")
  saveDraft(
    @Body() dto: SaveFooterDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ): Promise<FooterConfig> {
    // Mapped, not passed through: the service's validator must see a
    // plain object with exactly the known keys and explicit nulls for
    // what the operator left unset. See `footerConfigFromDto`.
    return this.footer.saveDraft(footerConfigFromDto(dto), ctxFrom(session, req));
  }

  @Post("publish")
  publish(
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ): Promise<FooterConfig> {
    return this.footer.publish(ctxFrom(session, req));
  }

  @Delete("draft")
  @HttpCode(204)
  discardDraft(
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ): Promise<void> {
    return this.footer.discardDraft(ctxFrom(session, req));
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
