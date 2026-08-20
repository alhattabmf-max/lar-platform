import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { normalizeDigitsAndWhitespace } from "../common/text/normalize-digits.util";
import type { UpdateTraderTaxProfileDto } from "./dto/update-trader-tax-profile.dto";

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const SAUDI_VAT_NUMBER_PATTERN = /^\d{15}$/;
const MAX_LEGAL_NAME_LENGTH = 300;

@Injectable()
export class TraderTaxProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async get(companyId: string) {
    return this.prisma.traderTaxProfile.findUnique({ where: { companyId } });
  }

  async upsert(dto: UpdateTraderTaxProfileDto, ctx: ActorContext) {
    let vatNumber: string | null = null;
    if (dto.isVatRegistered) {
      const normalized = normalizeDigitsAndWhitespace(dto.vatNumber ?? "");
      if (!SAUDI_VAT_NUMBER_PATTERN.test(normalized)) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "vatNumber is required and must be exactly 15 digits when isVatRegistered is true");
      }
      vatNumber = normalized;
    } else if (dto.vatNumber && normalizeDigitsAndWhitespace(dto.vatNumber).length > 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "vatNumber must not be provided when isVatRegistered is false");
    }

    const billingLegalName = dto.billingLegalName.trim();
    if (billingLegalName.length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "billingLegalName must not be empty");
    }
    if (billingLegalName.length > MAX_LEGAL_NAME_LENGTH) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, `billingLegalName must be at most ${MAX_LEGAL_NAME_LENGTH} characters`);
    }

    const before = await this.get(ctx.companyId);

    const profile = await this.prisma.traderTaxProfile.upsert({
      where: { companyId: ctx.companyId },
      create: { companyId: ctx.companyId, isVatRegistered: dto.isVatRegistered, vatNumber, billingLegalName },
      update: { isVatRegistered: dto.isVatRegistered, vatNumber, billingLegalName },
    });

    // Never log vatNumber or the legal name itself — only companyId
    // and the profile's completion state.
    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "TRADER_TAX_PROFILE_UPDATED",
      entityType: "trader_tax_profile",
      entityId: profile.id,
      before: before ? { isVatRegistered: before.isVatRegistered, complete: true } : undefined,
      after: { isVatRegistered: profile.isVatRegistered, complete: true },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return profile;
  }
}
