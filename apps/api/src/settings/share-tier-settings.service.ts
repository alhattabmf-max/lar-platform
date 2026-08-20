import { Injectable, Logger } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { validateShareTiers, type ShareTier } from "@platform/domain";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface ShareTierPolicyVersionRecord {
  id: string;
  version: number;
  tiers: ShareTier[];
}

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Unlike TaxRateSettingsService/OpportunitySettingsService (a single
 * mutable row), this is Append-Only — every admin change inserts a
 * NEW row in share_tier_policy_versions, never updates one (enforced
 * unconditionally by a DB trigger). This is deliberate: an already-
 * published Opportunity pins a specific historical version forever
 * (Opportunity.shareTierPolicyVersionId), so recomputing its tier on
 * a later SCHEDULED edit or ACTION_REQUIRED republish must be able to
 * look that exact historical version up again — a single mutable row
 * would lose that history the moment an admin changed it.
 *
 * Version 1 (the documented default tiers) is seeded by its own
 * migration, so getCurrentPolicy() always finds a real row.
 *
 * Same strict philosophy as TaxRateSettingsService: a malformed
 * stored row or a genuine DB read failure both throw — never a silent
 * fallback.
 */
@Injectable()
export class ShareTierSettingsService {
  private readonly logger = new Logger(ShareTierSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getCurrentPolicy(): Promise<ShareTierPolicyVersionRecord> {
    const row = await this.prisma.shareTierPolicyVersion.findFirst({
      orderBy: { version: "desc" },
    });
    if (!row) {
      throw new Error("share_tier_policy_versions has no rows — Version 1 should always exist");
    }
    return this.parseRow(row.id, row.version, row.tiers);
  }

  async getPolicyByVersionId(id: string): Promise<ShareTierPolicyVersionRecord> {
    const row = await this.prisma.shareTierPolicyVersion.findUnique({ where: { id } });
    if (!row) {
      throw new Error(`share_tier_policy_versions row not found for id=${id}`);
    }
    return this.parseRow(row.id, row.version, row.tiers);
  }

  async setPolicy(tiers: ShareTier[], ctx: ActorContext): Promise<ShareTierPolicyVersionRecord> {
    const validationError = validateShareTiers(tiers);
    if (validationError) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, `Invalid share tier policy: ${validationError}`);
    }

    const created = await this.prisma.shareTierPolicyVersion.create({
      data: { tiers: tiers as never, createdBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "SHARE_TIER_POLICY_CREATED",
      entityType: "share_tier_policy_version",
      entityId: created.id,
      after: { version: created.version, tiers: tiers as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.parseRow(created.id, created.version, created.tiers);
  }

  private parseRow(id: string, version: number, rawTiers: unknown): ShareTierPolicyVersionRecord {
    if (!Array.isArray(rawTiers)) {
      this.logger.error(`share_tier_policy_versions[id=${id}] has a malformed tiers value — refusing to silently ignore it`);
      throw new Error(`share_tier_policy_versions[id=${id}] has a malformed tiers value`);
    }
    const validationError = validateShareTiers(rawTiers as ShareTier[]);
    if (validationError) {
      this.logger.error(`share_tier_policy_versions[id=${id}] failed validation: ${validationError}`);
      throw new Error(`share_tier_policy_versions[id=${id}] failed validation: ${validationError}`);
    }
    return { id, version, tiers: rawTiers as ShareTier[] };
  }
}
