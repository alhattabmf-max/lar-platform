import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { SettingsService } from "./settings.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";

export interface BannerLinkAllowlistConfig {
  allowedHosts: string[];
}

const KEY = "banner_link_allowlist";

/**
 * Empty by default, and deliberately so: until an operator names a host,
 * no external banner link can be saved at all. Internal paths never
 * consult this list, so an empty allowlist is a usable state rather than
 * a broken one — banners can still link into the app.
 */
const DEFAULT_CONFIG: BannerLinkAllowlistConfig = { allowedHosts: [] };

const MAX_HOSTS = 50;

/** A hostname, optionally with a port. No scheme, no path, no wildcard. */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class BannerLinkAllowlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService
  ) {}

  /**
   * Fail-safe: a missing, malformed, or unreadable row resolves to the
   * EMPTY list. Failing closed here means a corrupt setting blocks
   * external links rather than admitting arbitrary ones.
   */
  async getAllowedHosts(): Promise<string[]> {
    const config = await this.settings.getJsonSafe(
      KEY,
      (v) => this.validate(v),
      DEFAULT_CONFIG
    );
    return config.allowedHosts;
  }

  async setAllowedHosts(value: BannerLinkAllowlistConfig, ctx: ActorContext): Promise<void> {
    const validated = this.validate(value);
    if (validated === null) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Allowed hosts must be bare hostnames (optionally with a port), with no scheme, path, or wildcard"
      );
    }

    const before = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });

    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: validated as never, updatedBy: ctx.actorId },
      update: { value: validated as never, updatedBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "BANNER_LINK_ALLOWLIST_UPDATED",
      entityType: "system_setting",
      entityId: KEY,
      before: before ? { value: before.value } : undefined,
      after: { value: validated as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private validate(value: unknown): BannerLinkAllowlistConfig | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;

    if (!Array.isArray(v.allowedHosts)) return null;
    if (v.allowedHosts.length > MAX_HOSTS) return null;

    const hosts: string[] = [];
    for (const raw of v.allowedHosts) {
      if (typeof raw !== "string") return null;
      const host = raw.trim().toLowerCase();
      // A scheme, a path, or a wildcard here would silently widen the
      // check in validateBannerLink, which compares against url.host.
      if (!HOST_PATTERN.test(host)) return null;
      if (!hosts.includes(host)) hosts.push(host);
    }

    return { allowedHosts: hosts };
  }
}
