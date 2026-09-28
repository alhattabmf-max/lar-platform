import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { AuditActorType, CompanyVerificationStatus } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { SETTINGS_KEYS } from "../settings/settings-keys.constants";
import { VERIFICATION_PROVIDER, type VerificationProvider } from "./verification-provider.interface";

interface ActorContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * All verification state transitions live here as plain service
 * methods — Blueprint amendment: no public HTTP endpoint for
 * approve/reject before Phase 3's Admin Auth exists. `reapply` IS
 * exposed over HTTP (see verification.controller.ts) because it is the
 * supplier acting on their own company, not an admin action.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(VERIFICATION_PROVIDER) private readonly provider: VerificationProvider
  ) {}

  /**
   * Called once, right after a supplier company is created. Trader
   * companies never go through this (they start VERIFIED, per the
   * Blueprint amendment, and are never routed here).
   */
  async evaluateOnRegistration(
    companyId: string,
    crNumber: string,
    legalName: string,
    ctx: ActorContext
  ): Promise<void> {
    const mode = await this.settings.getString(SETTINGS_KEYS.COMPANY_VERIFICATION_MODE, "MANUAL");

    if (mode !== "AUTOMATIC") {
      // Stays PENDING_VERIFICATION — nothing to do or audit yet.
      return;
    }

    const result = await this.provider.verify({ companyId, crNumber, legalName });

    if (result.approved) {
      await this.transition(
        companyId,
        CompanyVerificationStatus.PENDING_VERIFICATION,
        CompanyVerificationStatus.VERIFIED,
        { actorType: AuditActorType.SYSTEM, action: "COMPANY_VERIFICATION_APPROVED", ctx }
      );
    } else {
      await this.transition(
        companyId,
        CompanyVerificationStatus.PENDING_VERIFICATION,
        CompanyVerificationStatus.REJECTED,
        {
          actorType: AuditActorType.SYSTEM,
          action: "COMPANY_VERIFICATION_REJECTED",
          reason: result.reason,
          ctx,
        }
      );
    }
  }

  // NO approve, NO reject, NO reapply.
  //
  // These three moved a company's verification status directly,
  // with nothing recording WHAT had been reviewed. Approving a
  // supplier is now one decision on one submitted request, taken in
  // `SupplierVerificationRequestService` in a single transaction
  // with the request itself — so there is no way to verify a company
  // without a request behind it, and no way to decide a request
  // without moving the company.
  //
  // `reapply` was the worst of the three: it moved a REJECTED
  // company back to PENDING with nobody deciding anything, which
  // let a supplier overturn its own refusal.
  //
  // `transition` stays below: it is what the admin console's
  // suspend and reinstate paths use, and neither of those produces
  // VERIFIED.

  private async transition(
    companyId: string,
    expectedFrom: CompanyVerificationStatus,
    to: CompanyVerificationStatus,
    meta: {
      actorType: AuditActorType;
      actorId?: string;
      action: string;
      reason?: string;
      ctx: ActorContext;
    }
  ): Promise<void> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new BadRequestException("Company not found");
    }
    if (company.verificationStatus !== expectedFrom) {
      throw new BadRequestException(
        `Cannot transition company from ${company.verificationStatus} via this action (expected ${expectedFrom})`
      );
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: { verificationStatus: to },
    });

    await this.audit.log({
      actorType: meta.actorType,
      actorId: meta.actorId,
      companyId,
      action: meta.action,
      entityType: "company",
      entityId: companyId,
      before: { verificationStatus: expectedFrom },
      after: { verificationStatus: to },
      reason: meta.reason,
      requestId: meta.ctx.requestId,
      ipAddress: meta.ctx.ipAddress,
      userAgent: meta.ctx.userAgent,
    });
  }
}
