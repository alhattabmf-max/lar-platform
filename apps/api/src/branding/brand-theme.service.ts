import { Injectable, Logger } from "@nestjs/common";
import { AuditActorType, type Prisma } from "@prisma/client";
import {
  DEFAULT_BRAND_THEME,
  ERROR_CODES,
  type BrandThemeAdminView,
  type BrandThemeColors,
  type BrandThemeDraft,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import {
  parseThemeColors,
  themeFromStoredValue,
  validateThemeContrast,
  validateThemeInput,
} from "./brand-theme.validation";

/**
 * Brand theme storage.
 *
 * Three states, no new table and no migration
 * (docs/PHASE_8_IMPLEMENTATION_PLAN.md §14.5):
 *
 *   ACTIVE   system_settings["brand_theme_active"] — what the public sees
 *   DRAFT    system_settings["brand_theme_draft"]  — admin working copy
 *   DEFAULT  DEFAULT_BRAND_THEME, a code constant
 *
 * The default is a constant rather than a row precisely so it cannot be
 * corrupted, deleted, or silently edited — it is the anchor every
 * fallback resolves to.
 *
 * `SystemSetting` has no version chain. The `*Version` tables exist for
 * financial and legal policies, where an immutable chain is needed to
 * audit money; a presentational theme does not carry that requirement.
 * History is instead non-silent through AuditLog, which records
 * before/after for every draft save, publish, and reset.
 */

export const ACTIVE_THEME_KEY = "brand_theme_active";
export const DRAFT_THEME_KEY = "brand_theme_draft";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class BrandThemeService {
  private readonly logger = new Logger(BrandThemeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * The active theme, for public consumption.
   *
   * Fail-safe on every axis: a missing row, a malformed value, and a
   * database failure all resolve to the defaults. Losing the brand
   * colours must never take the site down or render it unreadable —
   * this is the same trade SettingsService.getJsonSafe makes for
   * rate-limit and media policy, and for the same reason.
   */
  async getActive(): Promise<BrandThemeColors> {
    try {
      const row = await this.prisma.systemSetting.findUnique({ where: { key: ACTIVE_THEME_KEY } });
      if (!row) return { ...DEFAULT_BRAND_THEME };

      const parsed = parseThemeColors(row.value);
      if (!parsed) {
        this.logger.error(
          `[fail-safe] system_settings["${ACTIVE_THEME_KEY}"] is malformed — serving the default theme`
        );
        return { ...DEFAULT_BRAND_THEME };
      }
      return parsed;
    } catch (err) {
      this.logger.error(
        `[fail-safe] Failed to read system_settings["${ACTIVE_THEME_KEY}"], serving the default theme: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
      return { ...DEFAULT_BRAND_THEME };
    }
  }

  /** Admin-only aggregate: active + draft + defaults + validation. */
  async getAdminView(): Promise<BrandThemeAdminView> {
    const [activeRow, draftRow] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { key: ACTIVE_THEME_KEY } }),
      this.prisma.systemSetting.findUnique({ where: { key: DRAFT_THEME_KEY } }),
    ]);

    const active = themeFromStoredValue(activeRow?.value);

    let draft: BrandThemeDraft | null = null;
    if (draftRow) {
      const colors = themeFromStoredValue(draftRow.value);
      draft = {
        colors,
        updatedAt: draftRow.updatedAt.toISOString(),
        validation: validateThemeContrast(colors),
      };
    }

    return {
      active,
      draft,
      defaults: { ...DEFAULT_BRAND_THEME },
      activeValidation: validateThemeContrast(active),
    };
  }

  /**
   * Saves a draft.
   *
   * Format failures are refused — a malformed hex is structurally
   * invalid and storing it would corrupt the row. Contrast failures are
   * accepted and returned, so the 8F screen can show an admin exactly
   * which pairs fail while they experiment. Publish is where contrast
   * becomes blocking.
   */
  async saveDraft(input: unknown, ctx: ActorContext): Promise<BrandThemeDraft> {
    const colors = parseThemeColors(input);
    if (!colors) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Brand theme colours must each be a full six-digit hex value"
      );
    }

    const before = await this.prisma.systemSetting.findUnique({ where: { key: DRAFT_THEME_KEY } });

    const saved = await this.prisma.systemSetting.upsert({
      where: { key: DRAFT_THEME_KEY },
      create: {
        key: DRAFT_THEME_KEY,
        value: colors as unknown as Prisma.InputJsonValue,
        updatedBy: ctx.actorId,
      },
      update: { value: colors as unknown as Prisma.InputJsonValue, updatedBy: ctx.actorId },
    });

    await this.logChange("BRAND_THEME_DRAFT_SAVED", DRAFT_THEME_KEY, before?.value, colors, ctx);

    return {
      colors,
      updatedAt: saved.updatedAt.toISOString(),
      validation: validateThemeContrast(colors),
    };
  }

  /**
   * Promotes the draft to active, atomically.
   *
   * Read-validate-write happens inside a single transaction, so a
   * concurrent draft save cannot land between the validation and the
   * write and publish an unvalidated theme. Publish refuses on ANY
   * issue — format or contrast.
   */
  async publish(ctx: ActorContext): Promise<BrandThemeColors> {
    const published = await this.prisma.$transaction(async (tx) => {
      const draftRow = await tx.systemSetting.findUnique({ where: { key: DRAFT_THEME_KEY } });
      if (!draftRow) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "There is no brand theme draft to publish"
        );
      }

      const validation = validateThemeInput(draftRow.value);
      if (!validation.valid) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "The brand theme draft does not meet the required contrast and format rules"
        );
      }

      const colors = parseThemeColors(draftRow.value) as BrandThemeColors;

      await tx.systemSetting.upsert({
        where: { key: ACTIVE_THEME_KEY },
        create: {
          key: ACTIVE_THEME_KEY,
          value: colors as unknown as Prisma.InputJsonValue,
          updatedBy: ctx.actorId,
        },
        update: { value: colors as unknown as Prisma.InputJsonValue, updatedBy: ctx.actorId },
      });

      return colors;
    });

    await this.logChange("BRAND_THEME_PUBLISHED", ACTIVE_THEME_KEY, undefined, published, ctx);
    return published;
  }

  /**
   * Restores the FORSA defaults and clears the draft, atomically, so the
   * two can never disagree about what "reset" produced.
   */
  async reset(ctx: ActorContext): Promise<BrandThemeColors> {
    const before = await this.prisma.systemSetting.findUnique({ where: { key: ACTIVE_THEME_KEY } });
    const defaults = { ...DEFAULT_BRAND_THEME };

    await this.prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: ACTIVE_THEME_KEY },
        create: {
          key: ACTIVE_THEME_KEY,
          value: defaults as unknown as Prisma.InputJsonValue,
          updatedBy: ctx.actorId,
        },
        update: { value: defaults as unknown as Prisma.InputJsonValue, updatedBy: ctx.actorId },
      });
      await tx.systemSetting.deleteMany({ where: { key: DRAFT_THEME_KEY } });
    });

    await this.logChange("BRAND_THEME_RESET", ACTIVE_THEME_KEY, before?.value, defaults, ctx);
    return defaults;
  }

  private async logChange(
    action: string,
    entityId: string,
    before: unknown,
    after: BrandThemeColors,
    ctx: ActorContext
  ): Promise<void> {
    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action,
      entityType: "system_setting",
      entityId,
      before: before === undefined ? undefined : ({ value: before } as Prisma.InputJsonValue),
      after: { value: after } as unknown as Prisma.InputJsonValue,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
