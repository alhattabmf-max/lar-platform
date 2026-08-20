import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { SettingsService } from "./settings.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

const KEY = "payout_hold_days";
const DEFAULT_DAYS = 3;
const BOUNDS = { min: 1, max: 30 }; // 0 is deliberately unreachable via this setting

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class FinancialSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService
  ) {}

  async getPayoutHoldDays(): Promise<number> {
    return this.settings.getJsonSafe(KEY, (v) => this.validate(v), DEFAULT_DAYS);
  }

  async setPayoutHoldDays(days: number, ctx: ActorContext): Promise<void> {
    if (this.validate(days) === null) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `payout_hold_days must be an integer between ${BOUNDS.min} and ${BOUNDS.max}`
      );
    }

    const before = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });

    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: days, updatedBy: ctx.actorId },
      update: { value: days, updatedBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "PAYOUT_HOLD_DAYS_UPDATED",
      entityType: "system_setting",
      entityId: KEY,
      before: before ? { value: before.value } : undefined,
      after: { value: days },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private validate(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isInteger(value)) return null;
    if (value < BOUNDS.min || value > BOUNDS.max) return null;
    return value;
  }
}
