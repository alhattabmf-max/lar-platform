import { Injectable, Logger } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface CheckoutSettingsConfig {
  lockDurationMinutes: number;
  abuseThresholdCount: number;
  abuseWindowMinutes: number;
  cooldownMinutes: number;
}

const KEY = "checkout_settings";

const DEFAULT_CONFIG: CheckoutSettingsConfig = {
  lockDurationMinutes: 15,
  abuseThresholdCount: 3,
  abuseWindowMinutes: 60,
  cooldownMinutes: 30,
};

const BOUNDS = {
  lockDurationMinutes: { min: 1, max: 180 },
  abuseThresholdCount: { min: 1, max: 20 },
  abuseWindowMinutes: { min: 1, max: 1440 },
  cooldownMinutes: { min: 1, max: 1440 },
};

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class CheckoutSettingsService {
  private readonly logger = new Logger(CheckoutSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getConfig(): Promise<CheckoutSettingsConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    if (!row) return DEFAULT_CONFIG;

    const validated = this.validate(row.value);
    if (validated === null) {
      this.logger.error(
        `system_settings["${KEY}"] contains a malformed value (got ${JSON.stringify(row.value)}) — refusing to silently fall back to the default`
      );
      throw new Error(`system_settings["${KEY}"] has a malformed value`);
    }
    return validated;
  }

  async setConfig(value: CheckoutSettingsConfig, ctx: ActorContext): Promise<void> {
    if (this.validate(value) === null) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Checkout settings value is outside the allowed bounds");
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
      action: "CHECKOUT_SETTINGS_UPDATED",
      entityType: "system_setting",
      entityId: KEY,
      before: before ? { value: before.value } : undefined,
      after: { value: value as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private validate(value: unknown): CheckoutSettingsConfig | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;

    if (!this.inBounds(v.lockDurationMinutes, BOUNDS.lockDurationMinutes)) return null;
    if (!this.inBounds(v.abuseThresholdCount, BOUNDS.abuseThresholdCount)) return null;
    if (!this.inBounds(v.abuseWindowMinutes, BOUNDS.abuseWindowMinutes)) return null;
    if (!this.inBounds(v.cooldownMinutes, BOUNDS.cooldownMinutes)) return null;

    return {
      lockDurationMinutes: v.lockDurationMinutes as number,
      abuseThresholdCount: v.abuseThresholdCount as number,
      abuseWindowMinutes: v.abuseWindowMinutes as number,
      cooldownMinutes: v.cooldownMinutes as number,
    };
  }

  private inBounds(value: unknown, bounds: { min: number; max: number }): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
  }
}
