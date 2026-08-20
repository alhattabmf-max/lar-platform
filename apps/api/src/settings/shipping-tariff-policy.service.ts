import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface ShippingTariffPolicyRecord {
  id: string;
  version: number;
  sameCityFeeAmount: number;
  sameRegionDifferentCityFeeAmount: number;
  differentRegionFeeAmount: number;
  providerCode: string;
}

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Append-Only, identical pattern to CommissionPolicyService/
 * ShareTierSettingsService — every admin change inserts a NEW row,
 * never updates one (enforced unconditionally by a DB trigger).
 *
 * Deliberately UNLIKE those two: no Version 1 is seeded by migration.
 * getCurrentPolicy() throws SHIPPING_TARIFF_NOT_CONFIGURED until an
 * admin explicitly sets a tariff — inventing a starting price here
 * would be a real commercial decision this service must never make
 * silently.
 */
@Injectable()
export class ShippingTariffPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getCurrentPolicy(): Promise<ShippingTariffPolicyRecord> {
    const row = await this.prisma.shippingTariffPolicyVersion.findFirst({ orderBy: { version: "desc" } });
    if (!row) {
      throw new BusinessException(
        400,
        ERROR_CODES.SHIPPING_TARIFF_NOT_CONFIGURED,
        "Shipping tariff has not been configured yet — an administrator must set it before checkout is possible"
      );
    }
    return this.toRecord(row);
  }

  async getPolicyByVersionId(id: string): Promise<ShippingTariffPolicyRecord> {
    const row = await this.prisma.shippingTariffPolicyVersion.findUnique({ where: { id } });
    if (!row) {
      throw new Error(`shipping_tariff_policy_versions row not found for id=${id}`);
    }
    return this.toRecord(row);
  }

  async setPolicy(
    input: { sameCityFeeAmount: number; sameRegionDifferentCityFeeAmount: number; differentRegionFeeAmount: number },
    ctx: ActorContext
  ): Promise<ShippingTariffPolicyRecord> {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, `${key} must be a non-negative number`);
      }
    }

    const created = await this.prisma.shippingTariffPolicyVersion.create({
      data: {
        sameCityFeeAmount: input.sameCityFeeAmount,
        sameRegionDifferentCityFeeAmount: input.sameRegionDifferentCityFeeAmount,
        differentRegionFeeAmount: input.differentRegionFeeAmount,
        createdBy: ctx.actorId,
      },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "SHIPPING_TARIFF_POLICY_CREATED",
      entityType: "shipping_tariff_policy_version",
      entityId: created.id,
      after: { version: created.version, ...input },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toRecord(created);
  }

  private toRecord(row: {
    id: string;
    version: number;
    sameCityFeeAmount: unknown;
    sameRegionDifferentCityFeeAmount: unknown;
    differentRegionFeeAmount: unknown;
    providerCode: string;
  }): ShippingTariffPolicyRecord {
    return {
      id: row.id,
      version: row.version,
      sameCityFeeAmount: Number(row.sameCityFeeAmount),
      sameRegionDifferentCityFeeAmount: Number(row.sameRegionDifferentCityFeeAmount),
      differentRegionFeeAmount: Number(row.differentRegionFeeAmount),
      providerCode: row.providerCode,
    };
  }
}
