import { Injectable, Logger } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface DefaultTaxRateConfig {
  ratePercent: number;
  /** Increments on every admin change — becomes part of ruleVersion for full traceability. */
  version: number;
}

/**
 * Thrown by getDefaultRate() specifically when the stored value is
 * corrupted/malformed — distinguished from any other Error (a genuine
 * DB read failure) so setDefaultRate() can treat "the existing config
 * is corrupt" as recoverable (an admin overwriting it fixes it) while
 * still letting a real database outage propagate and block the write.
 */
export class MalformedTaxRateSettingError extends Error {}

const KEY = "default_tax_rate";
const BOUNDS = { min: 0, max: 100 };

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * NO hardcoded rate anywhere in this file, in code, or in any
 * migration — the standard operational rate (e.g. 15% Saudi VAT) is
 * entered by an administrator once, at system setup time, through
 * setDefaultRate(). Until that happens, getDefaultRate() returns
 * null — deliberately NOT a safe-default fallback like every other
 * bounded settings service in this codebase (SecuritySettingsService,
 * MediaPolicyService, FinancialSettingsService).
 *
 * A second, equally deliberate deviation from those services: this
 * one does NOT use SettingsService.getJsonSafe(), because that
 * helper's whole contract is "any DB read failure silently becomes
 * the fallback value" — here that would make a genuine database
 * outage indistinguishable from "an admin simply hasn't configured
 * tax yet," which are two completely different situations a caller
 * (and an on-call engineer) must be able to tell apart. So:
 *   - row absent (never configured)      -> resolves to null
 *   - row present but malformed          -> throws
 *   - the database read itself fails     -> throws (propagates as-is)
 * Only the first case is treated as normal, expected, "not configured
 * yet" state. A missing tax rate blocks publishing an Opportunity
 * with a clear business error; a DB failure surfaces as a real error,
 * never silently as "not configured."
 */
@Injectable()
export class TaxRateSettingsService {
  private readonly logger = new Logger(TaxRateSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getDefaultRate(): Promise<DefaultTaxRateConfig | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    if (!row) return null;

    const validated = this.validate(row.value);
    if (validated === null) {
      this.logger.error(
        `system_settings["${KEY}"] contains a malformed value (got ${JSON.stringify(row.value)}) — refusing to silently treat this as "not configured"`
      );
      throw new MalformedTaxRateSettingError(`system_settings["${KEY}"] has a malformed value`);
    }
    return validated;
  }

  async setDefaultRate(ratePercent: number, ctx: ActorContext): Promise<DefaultTaxRateConfig> {
    if (typeof ratePercent !== "number" || ratePercent < BOUNDS.min || ratePercent > BOUNDS.max) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `ratePercent must be between ${BOUNDS.min} and ${BOUNDS.max}`
      );
    }

    const current = await this.getDefaultRate().catch((err) => {
      if (err instanceof MalformedTaxRateSettingError) return null; // recoverable: this write fixes it
      throw err; // a genuine DB failure must still block the write
    });
    const next: DefaultTaxRateConfig = { ratePercent, version: (current?.version ?? 0) + 1 };

    const before = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });

    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next as never, updatedBy: ctx.actorId },
      update: { value: next as never, updatedBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "DEFAULT_TAX_RATE_UPDATED",
      entityType: "system_setting",
      entityId: KEY,
      before: before ? { value: before.value } : undefined,
      after: { value: next as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return next;
  }

  private validate(value: unknown): DefaultTaxRateConfig | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.ratePercent !== "number" || v.ratePercent < BOUNDS.min || v.ratePercent > BOUNDS.max) {
      return null;
    }
    if (typeof v.version !== "number" || !Number.isInteger(v.version) || v.version < 1) {
      return null;
    }
    return { ratePercent: v.ratePercent, version: v.version };
  }
}
