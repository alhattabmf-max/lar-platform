import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { requireVerifiedSupplierCompany } from "./require-verified-supplier";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { UpdateTaxProfileDto } from "./dto/update-tax-profile.dto";

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const SAUDI_VAT_NUMBER_PATTERN = /^\d{15}$/;

@Injectable()
export class TaxProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async get(companyId: string) {
    return this.prisma.supplierTaxProfile.findUnique({ where: { companyId } });
  }

  async upsert(dto: UpdateTaxProfileDto, ctx: ActorContext) {
    await requireVerifiedSupplierCompany(this.prisma, ctx.companyId);

    let vatNumber: string | null = null;
    if (dto.isVatRegistered) {
      const normalized = dto.vatNumber?.trim() ?? "";
      if (!SAUDI_VAT_NUMBER_PATTERN.test(normalized)) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "vatNumber is required and must be exactly 15 digits when isVatRegistered is true"
        );
      }
      vatNumber = normalized;
    } else if (dto.vatNumber && dto.vatNumber.trim().length > 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "vatNumber must not be provided when isVatRegistered is false"
      );
    }

    const before = await this.get(ctx.companyId);

    const profile = await this.prisma.supplierTaxProfile.upsert({
      where: { companyId: ctx.companyId },
      create: { companyId: ctx.companyId, isVatRegistered: dto.isVatRegistered, vatNumber },
      update: { isVatRegistered: dto.isVatRegistered, vatNumber },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "TAX_PROFILE_UPDATED",
      entityType: "supplier_tax_profile",
      entityId: profile.id,
      before: before ? { isVatRegistered: before.isVatRegistered } : undefined,
      after: { isVatRegistered: profile.isVatRegistered },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return profile;
  }
}
