import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface CommissionPolicyRecord {
  id: string;
  version: number;
  rateBasisPoints: number;
}

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Append-Only, identical pattern and rationale to
 * ShareTierSettingsService: every admin change inserts a NEW row,
 * never updates one (enforced unconditionally by a DB trigger). An
 * already-published Opportunity pins a specific historical version
 * forever (Opportunity.commissionPolicyVersionId), so recomputing on
 * a later SCHEDULED edit or ACTION_REQUIRED republish must be able to
 * look that exact historical version up again.
 *
 * Version 1 (500 basis points = 5%) is seeded by its own migration,
 * so getCurrentPolicy() always finds a real row.
 */
@Injectable()
export class CommissionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getCurrentPolicy(): Promise<CommissionPolicyRecord> {
    const row = await this.prisma.commissionPolicyVersion.findFirst({ orderBy: { version: "desc" } });
    if (!row) {
      throw new Error("commission_policy_versions has no rows — Version 1 should always exist");
    }
    return { id: row.id, version: row.version, rateBasisPoints: row.rateBasisPoints };
  }

  async getPolicyByVersionId(id: string): Promise<CommissionPolicyRecord> {
    const row = await this.prisma.commissionPolicyVersion.findUnique({ where: { id } });
    if (!row) {
      throw new Error(`commission_policy_versions row not found for id=${id}`);
    }
    return { id: row.id, version: row.version, rateBasisPoints: row.rateBasisPoints };
  }

  async setPolicy(rateBasisPoints: number, ctx: ActorContext): Promise<CommissionPolicyRecord> {
    if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10000) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "rateBasisPoints must be an integer between 0 and 10000"
      );
    }

    const created = await this.prisma.commissionPolicyVersion.create({
      data: { rateBasisPoints, createdBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "COMMISSION_POLICY_CREATED",
      entityType: "commission_policy_version",
      entityId: created.id,
      after: { version: created.version, rateBasisPoints },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { id: created.id, version: created.version, rateBasisPoints: created.rateBasisPoints };
  }
}
