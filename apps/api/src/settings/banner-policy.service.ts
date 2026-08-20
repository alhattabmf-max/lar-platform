import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { SettingsService } from "./settings.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";

export interface BannerPolicyConfig {
  maxSizeBytes: number;
  maxPixels: number;
  allowedTypes: string[];
  /**
   * How many banners may be LIVE AT THE SAME INSTANT in one placement.
   *
   * Deliberately not a count of is_active rows: a banner whose window
   * has ended stays active, so a row count would let expired banners
   * consume slots permanently and the cap would ratchet shut. This is
   * an interval-overlap limit — see banner-window.util.ts.
   */
  maxConcurrentLiveBannersPerPlacement: number;
}

const KEY = "promotional_banner_policy";

/** The formats the image processor can actually decode and emit. */
const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const DEFAULT_POLICY: BannerPolicyConfig = {
  maxSizeBytes: 2 * 1024 * 1024,
  maxPixels: 8_000_000,
  allowedTypes: [...SUPPORTED_TYPES],
  maxConcurrentLiveBannersPerPlacement: 3,
};

const BOUNDS = {
  // Bounded above by the transport-layer hard ceiling shared with
  // product media, so an admin can never configure a value the HTTP
  // layer would reject before validation ever sees it.
  maxSizeBytes: { min: 50 * 1024, max: 20 * 1024 * 1024 },
  maxPixels: { min: 250_000, max: 40_000_000 },
  maxConcurrentLiveBannersPerPlacement: { min: 1, max: 10 },
};

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Uses the fail-safe read (`getJsonSafe`): a missing row, a malformed
 * value, and a database failure all resolve to the hardcoded default,
 * each logged at error level. Losing a presentational policy must never
 * take the public site down — the same trade MediaPolicyService makes.
 */
@Injectable()
export class BannerPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService
  ) {}

  async getPolicy(): Promise<BannerPolicyConfig> {
    return this.settings.getJsonSafe(KEY, (v) => this.validate(v), DEFAULT_POLICY);
  }

  async setPolicy(value: BannerPolicyConfig, ctx: ActorContext): Promise<void> {
    if (this.validate(value) === null) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Banner policy value is outside the allowed bounds"
      );
    }

    const before = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });

    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: value as never, updatedBy: ctx.actorId },
      update: { value: value as never, updatedBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "BANNER_POLICY_UPDATED",
      entityType: "system_setting",
      entityId: KEY,
      before: before ? { value: before.value } : undefined,
      after: { value: value as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private validate(value: unknown): BannerPolicyConfig | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;

    if (!this.inBounds(v.maxSizeBytes, BOUNDS.maxSizeBytes)) return null;
    if (!this.inBounds(v.maxPixels, BOUNDS.maxPixels)) return null;
    if (
      !this.inBounds(
        v.maxConcurrentLiveBannersPerPlacement,
        BOUNDS.maxConcurrentLiveBannersPerPlacement
      )
    ) {
      return null;
    }
    if (
      !Array.isArray(v.allowedTypes) ||
      v.allowedTypes.length === 0 ||
      !v.allowedTypes.every(
        (t) => typeof t === "string" && (SUPPORTED_TYPES as readonly string[]).includes(t)
      )
    ) {
      return null;
    }

    return {
      maxSizeBytes: v.maxSizeBytes as number,
      maxPixels: v.maxPixels as number,
      allowedTypes: v.allowedTypes as string[],
      maxConcurrentLiveBannersPerPlacement: v.maxConcurrentLiveBannersPerPlacement as number,
    };
  }

  private inBounds(value: unknown, bounds: { min: number; max: number }): boolean {
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= bounds.min &&
      value <= bounds.max
    );
  }
}
