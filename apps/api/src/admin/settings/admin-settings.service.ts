import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { BusinessException } from "../../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { SETTINGS_REGISTRY, getSettingDefinition } from "./settings-registry";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * The ONLY write path for generic (non-security-bounded) settings.
 * Every read and write goes through SETTINGS_REGISTRY — there is no
 * passthrough to arbitrary system_settings keys. Security-bounded
 * settings (rate limits, session duration) are intentionally absent
 * from the registry and therefore unreachable here; they live
 * exclusively in SecuritySettingsService.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /** Lists every registered setting and its current value (or null if unset). */
  async list() {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: Object.keys(SETTINGS_REGISTRY) } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));

    return Object.values(SETTINGS_REGISTRY).map((def) => ({
      key: def.key,
      type: def.type,
      description: def.description,
      adminWritable: def.adminWritable,
      allowedValues: def.allowedValues,
      value: byKey.get(def.key)?.value ?? null,
    }));
  }

  async get(key: string) {
    const def = this.requireDefinition(key);
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return {
      key: def.key,
      type: def.type,
      description: def.description,
      adminWritable: def.adminWritable,
      allowedValues: def.allowedValues,
      value: row?.value ?? null,
    };
  }

  async setValue(key: string, value: unknown, ctx: ActorContext): Promise<void> {
    const def = this.requireDefinition(key);

    if (!def.adminWritable) {
      throw new ForbiddenException(`Setting "${key}" is not admin-writable`);
    }
    if (!def.validate(value)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Value for "${key}" failed validation` +
          (def.allowedValues ? ` (allowed: ${def.allowedValues.join(", ")})` : "")
      );
    }

    const before = await this.prisma.systemSetting.findUnique({ where: { key } });

    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as never, updatedBy: ctx.actorId },
      update: { value: value as never, updatedBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "SYSTEM_SETTING_UPDATED",
      entityType: "system_setting",
      entityId: key,
      before: before ? { value: before.value } : undefined,
      after: { value: value as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private requireDefinition(key: string) {
    const def = getSettingDefinition(key);
    if (!def) {
      throw new NotFoundException(`"${key}" is not a recognized, admin-manageable setting`);
    }
    return def;
  }
}
