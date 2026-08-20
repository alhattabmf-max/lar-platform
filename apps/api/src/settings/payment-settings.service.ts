import { Injectable, Logger } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface PaymentSettingsConfig {
  paymentAttemptTimeoutMinutes: number;
}

const KEY = "payment_settings";
const DEFAULT_CONFIG: PaymentSettingsConfig = { paymentAttemptTimeoutMinutes: 15 };
const BOUNDS = { min: 1, max: 180 };

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class PaymentSettingsService {
  private readonly logger = new Logger(PaymentSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getConfig(): Promise<PaymentSettingsConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    if (!row) return DEFAULT_CONFIG;

    const validated = this.validate(row.value);
    if (validated === null) {
      this.logger.error(`system_settings["${KEY}"] contains a malformed value — refusing to silently fall back`);
      throw new Error(`system_settings["${KEY}"] has a malformed value`);
    }
    return validated;
  }

  async setConfig(value: PaymentSettingsConfig, ctx: ActorContext): Promise<void> {
    if (this.validate(value) === null) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "paymentAttemptTimeoutMinutes is outside the allowed bounds");
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
      action: "PAYMENT_SETTINGS_UPDATED",
      entityType: "system_setting",
      entityId: KEY,
      before: before ? { value: before.value } : undefined,
      after: { value: value as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private validate(value: unknown): PaymentSettingsConfig | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    const t = v.paymentAttemptTimeoutMinutes;
    if (typeof t !== "number" || !Number.isInteger(t) || t < BOUNDS.min || t > BOUNDS.max) return null;
    return { paymentAttemptTimeoutMinutes: t };
  }
}
