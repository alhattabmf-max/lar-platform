import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { BannerService } from "../../banners/banner.service";
import { BannerLinkService } from "../../banners/banner-link.service";
import {
  CreateBannerDto,
  ListBannersQueryDto,
  ReorderBannersDto,
  SetBannerScheduleDto,
  ToggleBannerDto,
  UpdateBannerDto,
} from "./dto/banner.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

/**
 * Thin by construction: every method resolves a context, converts
 * transport types (ISO strings to Date), and delegates. No scheduling
 * rule, no overlap arithmetic and no locking lives here — those belong
 * to BannerService, which is also where they can be unit-tested without
 * an HTTP layer.
 *
 * `AdminSessionAuthGuard` already implies completed 2FA: the admin
 * cookie is only issued after 2FA verification, so a separate check
 * would duplicate an invariant the session already carries.
 *
 * `CsrfGuard` sits at controller level following the existing admin
 * pattern. It is inert on GET, which the CSRF provider exempts by
 * design, and active on every mutation below.
 */
@Controller("admin/banners")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminBannerController {
  constructor(
    private readonly banners: BannerService,
    private readonly links: BannerLinkService,
  ) {}

  @Get()
  list(@Query() query: ListBannersQueryDto) {
    return this.banners.listForAdmin(query.placement);
  }

  @Post()
  async create(
    @Body() dto: CreateBannerDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.banners.create(
      {
        placement: dto.placement,
        linkUrl: await this.links.normalise(dto.linkUrl ?? null),
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? false,
        startsAt: toDate(dto.startsAt),
        endsAt: toDate(dto.endsAt),
      },
      ctxFrom(session, req),
    );
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateBannerDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.banners.updateContent(
      id,
      {
        ...(dto.titleAr !== undefined ? { titleAr: dto.titleAr } : {}),
        ...(dto.titleEn !== undefined ? { titleEn: dto.titleEn } : {}),
        ...(dto.bodyAr !== undefined ? { bodyAr: dto.bodyAr } : {}),
        ...(dto.bodyEn !== undefined ? { bodyEn: dto.bodyEn } : {}),
        ...(dto.linkUrl !== undefined
          ? { linkUrl: await this.links.normalise(dto.linkUrl) }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      ctxFrom(session, req),
    );
  }

  @Post(":id/schedule")
  setSchedule(
    @Param("id") id: string,
    @Body() dto: SetBannerScheduleDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.banners.setSchedule(
      id,
      { startsAt: toDate(dto.startsAt), endsAt: toDate(dto.endsAt) },
      ctxFrom(session, req),
    );
  }

  @Post(":id/toggle")
  toggle(
    @Param("id") id: string,
    @Body() dto: ToggleBannerDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.banners.setActive(id, dto.isActive, ctxFrom(session, req));
  }

  /**
   * Removes a banner for good, in any state — draft, scheduled or live.
   *
   * Separate from the toggle on purpose: deactivating is the reversible
   * control and this one is not, so they are two different actions
   * rather than one with a flag.
   */
  @Delete(":id")
  async remove(
    @Param("id") id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    await this.banners.delete(id, ctxFrom(session, req));
    return { status: "ok" };
  }

  @Post("reorder")
  reorder(
    @Body() dto: ReorderBannersDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.banners.reorder(
      dto.placement,
      dto.bannerIds,
      ctxFrom(session, req),
    );
  }
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function ctxFrom(session: AdminSessionData, req: Request) {
  return {
    actorId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}
