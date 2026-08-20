import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface CommissionTaxPolicyRecord {
  id: string;
  version: number;
  ratePercent: number;
  ruleCode: string;
  ruleVersion: string;
}

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class CommissionTaxPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getCurrentPolicy(): Promise<CommissionTaxPolicyRecord> {
    const row = await this.prisma.commissionTaxPolicyVersion.findFirst({ orderBy: { version: "desc" } });
    if (!row) {
      throw new BusinessException(
        400,
        ERROR_CODES.COMMISSION_TAX_NOT_CONFIGURED,
        "Commission tax has not been configured yet — an administrator must set it before payments can be captured"
      );
    }
    return this.toRecord(row);
  }

  async setPolicy(
    input: { ratePercent: number; ruleCode: string; ruleVersion: string },
    ctx: ActorContext
  ): Promise<CommissionTaxPolicyRecord> {
    if (typeof input.ratePercent !== "number" || !Number.isFinite(input.ratePercent) || input.ratePercent < 0 || input.ratePercent > 100) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "ratePercent must be between 0 and 100");
    }

    const created = await this.prisma.commissionTaxPolicyVersion.create({
      data: { ratePercent: input.ratePercent, ruleCode: input.ruleCode, ruleVersion: input.ruleVersion, createdBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "COMMISSION_TAX_POLICY_CREATED",
      entityType: "commission_tax_policy_version",
      entityId: created.id,
      after: { version: created.version, ...input },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toRecord(created);
  }

  private toRecord(row: { id: string; version: number; ratePercent: unknown; ruleCode: string; ruleVersion: string }): CommissionTaxPolicyRecord {
    return { id: row.id, version: row.version, ratePercent: Number(row.ratePercent), ruleCode: row.ruleCode, ruleVersion: row.ruleVersion };
  }
}
