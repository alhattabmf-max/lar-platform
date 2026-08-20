import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { SettingsService } from "./settings.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface RateLimitConfig {
  limit: number;
  ttlSeconds: number;
}

interface Bounds {
  limit: { min: number; max: number };
  ttlSeconds: { min: number; max: number };
}

const LOGIN_RATE_LIMIT_KEY = "admin_login_rate_limit";
const TWO_FA_RATE_LIMIT_KEY = "admin_2fa_rate_limit";
const SESSION_DURATION_KEY = "admin_session_duration_seconds";

// Hardcoded safe defaults — used whenever the stored setting is
// absent, malformed, or unreadable (DB failure). Protection is never
// weaker than this, regardless of what goes wrong reading config.
const LOGIN_RATE_LIMIT_DEFAULT: RateLimitConfig = { limit: 5, ttlSeconds: 60 };
const TWO_FA_RATE_LIMIT_DEFAULT: RateLimitConfig = { limit: 5, ttlSeconds: 60 };
const SESSION_DURATION_DEFAULT_SECONDS = 60 * 60 * 8; // 8 hours

const RATE_LIMIT_BOUNDS: Bounds = {
  limit: { min: 1, max: 20 },
  ttlSeconds: { min: 10, max: 300 },
};
const SESSION_DURATION_BOUNDS = { min: 60 * 15, max: 60 * 60 * 24 * 30 }; // 15 min .. 30 days

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SecuritySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService
  ) {}

  async getAdminLoginRateLimit(): Promise<RateLimitConfig> {
    return this.settings.getJsonSafe(
      LOGIN_RATE_LIMIT_KEY,
      (v) => this.validateRateLimit(v),
      LOGIN_RATE_LIMIT_DEFAULT
    );
  }

  async getAdmin2faRateLimit(): Promise<RateLimitConfig> {
    return this.settings.getJsonSafe(
      TWO_FA_RATE_LIMIT_KEY,
      (v) => this.validateRateLimit(v),
      TWO_FA_RATE_LIMIT_DEFAULT
    );
  }

  async getAdminSessionDurationSeconds(): Promise<number> {
    return this.settings.getJsonSafe(
      SESSION_DURATION_KEY,
      (v) => this.validateSessionDuration(v),
      SESSION_DURATION_DEFAULT_SECONDS
    );
  }

  async setAdminLoginRateLimit(value: RateLimitConfig, ctx: ActorContext): Promise<void> {
    await this.writeValidated(LOGIN_RATE_LIMIT_KEY, value, this.validateRateLimit.bind(this), ctx);
  }

  async setAdmin2faRateLimit(value: RateLimitConfig, ctx: ActorContext): Promise<void> {
    await this.writeValidated(TWO_FA_RATE_LIMIT_KEY, value, this.validateRateLimit.bind(this), ctx);
  }

  async setAdminSessionDurationSeconds(seconds: number, ctx: ActorContext): Promise<void> {
    await this.writeValidated(
      SESSION_DURATION_KEY,
      seconds,
      this.validateSessionDuration.bind(this),
      ctx
    );
  }

  private async writeValidated<T>(
    key: string,
    value: T,
    validate: (v: unknown) => T | null,
    ctx: ActorContext
  ): Promise<void> {
    if (validate(value) === null) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Value for "${key}" is outside the allowed bounds`
      );
    }

    const before = await this.prisma.systemSetting.findUnique({ where: { key } });

    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never, updatedBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "SECURITY_SETTING_UPDATED",
      entityType: "system_setting",
      entityId: key,
      before: before ? { value: before.value } : undefined,
      after: { value: value as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private validateRateLimit(value: unknown): RateLimitConfig | null {
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as Record<string, unknown>).limit !== "number" ||
      typeof (value as Record<string, unknown>).ttlSeconds !== "number"
    ) {
      return null;
    }
    const { limit, ttlSeconds } = value as RateLimitConfig;
    const b = RATE_LIMIT_BOUNDS;
    if (
      !Number.isInteger(limit) ||
      limit < b.limit.min ||
      limit > b.limit.max ||
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < b.ttlSeconds.min ||
      ttlSeconds > b.ttlSeconds.max
    ) {
      return null;
    }
    return { limit, ttlSeconds };
  }

  private validateSessionDuration(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isInteger(value)) return null;
    if (value < SESSION_DURATION_BOUNDS.min || value > SESSION_DURATION_BOUNDS.max) return null;
    return value;
  }
}
