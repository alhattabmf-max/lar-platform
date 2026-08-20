import { Injectable, Logger } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface FulfillmentSettingsConfig {
  lateThresholdPercent: number;
  criticalThresholdPercent: number;
}

const KEY = "fulfillment_settings";
const DEFAULT_CONFIG: FulfillmentSettingsConfig = { lateThresholdPercent: 100, criticalThresholdPercent: 130 };
const MAX_PERCENT = 1000;

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class FulfillmentSettingsService {
  private readonly logger = new Logger(FulfillmentSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getConfig(): Promise<FulfillmentSettingsConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    if (!row) return DEFAULT_CONFIG;

    const validated = this.validate(row.value);
    if (validated === null) {
      this.logger.error(`system_settings["${KEY}"] contains a malformed value — refusing to silently fall back`);
      throw new Error(`system_settings["${KEY}"] has a malformed value`);
    }
    return validated;
  }

  async setConfig(value: FulfillmentSettingsConfig, ctx: ActorContext): Promise<void> {
    if (this.validate(value) === null) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "lateThresholdPercent must be >= 100, criticalThresholdPercent must be > lateThresholdPercent, both within bounds"
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
      action: "FULFILLMENT_SETTINGS_UPDATED",
      entityType: "system_setting",
      entityId: KEY,
      before: before ? { value: before.value } : undefined,
      after: { value: value as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private validate(value: unknown): FulfillmentSettingsConfig | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    const late = v.lateThresholdPercent;
    const critical = v.criticalThresholdPercent;
    if (typeof late !== "number" || !Number.isFinite(late)) return null;
    if (typeof critical !== "number" || !Number.isFinite(critical)) return null;
    if (late < 100 || late > MAX_PERCENT) return null;
    if (critical <= late || critical > MAX_PERCENT) return null;
    return { lateThresholdPercent: late, criticalThresholdPercent: critical };
  }
}
