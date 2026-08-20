import { Injectable, Logger } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface OpportunitySettingsConfig {
  minDurationHours: number;
  maxDurationDays: number;
  minTargetQuantity: number;
  maxTargetQuantity: number;
  showScheduledPubliclyEnabled: boolean;
}

const KEY = "opportunity_settings";

// The ONLY fallback case: the setting has genuinely never been
// configured (no row at all). A malformed stored value or a real
// database read failure are NOT treated the same way — both throw
// instead, exactly like TaxRateSettingsService, rather than silently
// degrading to this default the way SecuritySettingsService/
// MediaPolicyService/FinancialSettingsService's SettingsService.getJsonSafe
// helper does for THEIR settings. Those services intentionally accept
// "malformed/DB-failure -> safe default" because losing rate-limit or
// media-policy protection would be worse than serving a conservative
// default; here, silently substituting a different set of commercial
// bounds than an admin configured (a corrupted config making
// max/min quantity limits wrong, say) is exactly the kind of silent
// substitution this service must never do.
const DEFAULT_CONFIG: OpportunitySettingsConfig = {
  minDurationHours: 24,
  maxDurationDays: 30,
  minTargetQuantity: 1,
  maxTargetQuantity: 1_000_000,
  showScheduledPubliclyEnabled: false,
};

const BOUNDS = {
  minDurationHours: { min: 1, max: 720 },
  maxDurationDays: { min: 1, max: 90 },
  minTargetQuantity: { min: 1, max: 1_000_000 },
  maxTargetQuantity: { min: 1, max: 10_000_000 },
};

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class OpportunitySettingsService {
  private readonly logger = new Logger(OpportunitySettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * - row absent (never configured)  -> resolves to DEFAULT_CONFIG
   * - row present but malformed      -> throws
   * - the database read itself fails -> throws (propagates as-is)
   * No silent fallback for the last two cases — a caller (and an
   * on-call engineer) must be able to tell "not configured yet" apart
   * from "something is actually broken."
   */
  async getConfig(): Promise<OpportunitySettingsConfig> {
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

  /**
   * Only ever reads/writes the single `opportunity_settings` row in
   * system_settings — never touches `opportunities` or any snapshot
   * table. Changing these operational bounds can therefore never
   * retroactively alter an already-created Opportunity's stored
   * values (target_quantity, duration, or any snapshot): the bounds
   * are enforced only at the moment a NEW create/publish call is
   * validated, by whichever service does that validation — they are
   * never re-applied against existing rows.
   */
  async setConfig(value: OpportunitySettingsConfig, ctx: ActorContext): Promise<void> {
    if (this.validate(value) === null) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Opportunity settings value is outside the allowed bounds"
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
      action: "OPPORTUNITY_SETTINGS_UPDATED",
      entityType: "system_setting",
      entityId: KEY,
      before: before ? { value: before.value } : undefined,
      after: { value: value as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private validate(value: unknown): OpportunitySettingsConfig | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;

    if (!this.inBounds(v.minDurationHours, BOUNDS.minDurationHours)) return null;
    if (!this.inBounds(v.maxDurationDays, BOUNDS.maxDurationDays)) return null;
    if (!this.inBounds(v.minTargetQuantity, BOUNDS.minTargetQuantity)) return null;
    if (!this.inBounds(v.maxTargetQuantity, BOUNDS.maxTargetQuantity)) return null;
    if (typeof v.showScheduledPubliclyEnabled !== "boolean") return null;

    const config = {
      minDurationHours: v.minDurationHours as number,
      maxDurationDays: v.maxDurationDays as number,
      minTargetQuantity: v.minTargetQuantity as number,
      maxTargetQuantity: v.maxTargetQuantity as number,
      showScheduledPubliclyEnabled: v.showScheduledPubliclyEnabled,
    };

    // Cross-field consistency: the target-quantity range must be
    // non-empty, and the duration range must allow at least the
    // minimum duration within the maximum window.
    if (config.maxTargetQuantity < config.minTargetQuantity) return null;
    if (config.maxDurationDays * 24 < config.minDurationHours) return null;

    return config;
  }

  private inBounds(value: unknown, bounds: { min: number; max: number }): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
  }
}
