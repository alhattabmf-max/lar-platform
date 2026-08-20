import { Injectable } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { normalizeDigitsAndWhitespace } from "../common/text/normalize-digits.util";

interface AdminActorContext {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const SAUDI_VAT_NUMBER_PATTERN = /^\d{15}$/;
const MAX_LEGAL_NAME_LENGTH = 300;

export interface CreatePlatformBillingProfileInput {
  legalName: string;
  crNumber: string;
  isVatRegistered: boolean;
  vatNumber?: string;
  addressSnapshot: Record<string, unknown>;
}

@Injectable()
export class PlatformBillingProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** The CURRENT (highest-version) profile, or null if none has ever been created. */
  async getCurrent() {
    return this.prisma.platformBillingProfileVersion.findFirst({ orderBy: { version: "desc" } });
  }

  async listAll() {
    return this.prisma.platformBillingProfileVersion.findMany({ orderBy: { version: "desc" } });
  }

  /** Creates a NEW version — never updates an existing one. */
  async createNewVersion(input: CreatePlatformBillingProfileInput, ctx: AdminActorContext) {
    const legalName = input.legalName.trim();
    if (legalName.length === 0 || legalName.length > MAX_LEGAL_NAME_LENGTH) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, `legalName must be non-empty and at most ${MAX_LEGAL_NAME_LENGTH} characters`);
    }
    const crNumber = input.crNumber.trim();
    if (crNumber.length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "crNumber must not be empty");
    }

    let vatNumber: string | null = null;
    if (input.isVatRegistered) {
      const normalized = normalizeDigitsAndWhitespace(input.vatNumber ?? "");
      if (!SAUDI_VAT_NUMBER_PATTERN.test(normalized)) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "vatNumber is required and must be exactly 15 digits when isVatRegistered is true");
      }
      vatNumber = normalized;
    } else if (input.vatNumber && normalizeDigitsAndWhitespace(input.vatNumber).length > 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "vatNumber must not be provided when isVatRegistered is false");
    }

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.platformBillingProfileVersion.findFirst({ orderBy: { version: "desc" } });
      const nextVersion = (latest?.version ?? 0) + 1;

      const profile = await tx.platformBillingProfileVersion.create({
        data: {
          version: nextVersion,
          legalName,
          crNumber,
          isVatRegistered: input.isVatRegistered,
          vatNumber,
          addressSnapshot: input.addressSnapshot as Prisma.InputJsonValue,
          createdByAdminUserId: ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          action: "PLATFORM_BILLING_PROFILE_VERSION_CREATED",
          entityType: "platform_billing_profile_version",
          entityId: profile.id,
          afterData: { version: profile.version, isVatRegistered: profile.isVatRegistered },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "PLATFORM_BILLING_PROFILE_VERSION_CREATED", payload: { version: profile.version } },
      });

      return profile;
    });
  }
}
