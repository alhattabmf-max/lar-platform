import { Injectable } from "@nestjs/common";
import { AuditActorType, BankAccountVerificationStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { FinancialSettingsService } from "../../settings/financial-settings.service";
import { BusinessException } from "../../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

interface ActorContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminBankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly financialSettings: FinancialSettingsService,
  ) {}

  async listPendingReview() {
    return this.prisma.supplierBankAccount.findMany({
      where: {
        verificationStatus: BankAccountVerificationStatus.PENDING_VERIFICATION,
      },
      select: {
        id: true,
        companyId: true,
        accountHolderName: true,
        bankName: true,
        ibanLast4: true,
        verificationStatus: true,
        createdAt: true,
        company: {
          select: { id: true, legalName: true, crNumber: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async approve(
    bankAccountId: string,
    adminUserId: string,
    ctx: ActorContext,
  ): Promise<void> {
    const account = await this.prisma.supplierBankAccount.findUnique({
      where: { id: bankAccountId },
    });
    if (
      !account ||
      account.verificationStatus !==
        BankAccountVerificationStatus.PENDING_VERIFICATION
    ) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Bank account is not pending review",
      );
    }

    const holdDays = await this.financialSettings.getPayoutHoldDays();
    const payoutHoldUntil = new Date(
      Date.now() + holdDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.supplierBankAccount.updateMany({
        where: {
          id: bankAccountId,
          companyId: account.companyId,
          verificationStatus:
            BankAccountVerificationStatus.PENDING_VERIFICATION,
        },
        data: {
          verificationStatus: BankAccountVerificationStatus.VERIFIED,
          verifiedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "Bank account review was already completed",
        );
      }

      const company = await tx.company.findUniqueOrThrow({
        where: { id: account.companyId },
      });

      if (
        company.activeBankAccountId &&
        company.activeBankAccountId !== bankAccountId
      ) {
        await tx.supplierBankAccount.update({
          where: { id: company.activeBankAccountId },
          data: {
            verificationStatus: BankAccountVerificationStatus.SUPERSEDED,
          },
        });
      }

      await tx.company.update({
        where: { id: account.companyId },
        data: { activeBankAccountId: bankAccountId, payoutHoldUntil },
      });
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminUserId,
      companyId: account.companyId,
      action: "BANK_ACCOUNT_APPROVED",
      entityType: "supplier_bank_account",
      entityId: bankAccountId,
      before: {
        verificationStatus: BankAccountVerificationStatus.PENDING_VERIFICATION,
      },
      after: {
        verificationStatus: BankAccountVerificationStatus.VERIFIED,
        payoutHoldUntil,
      },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async reject(
    bankAccountId: string,
    reason: string,
    adminUserId: string,
    ctx: ActorContext,
  ): Promise<void> {
    const account = await this.prisma.supplierBankAccount.findUnique({
      where: { id: bankAccountId },
    });
    if (
      !account ||
      account.verificationStatus !==
        BankAccountVerificationStatus.PENDING_VERIFICATION
    ) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Bank account is not pending review",
      );
    }

    await this.prisma.supplierBankAccount.update({
      where: { id: bankAccountId },
      data: {
        verificationStatus: BankAccountVerificationStatus.REJECTED,
        rejectionReason: reason,
      },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminUserId,
      companyId: account.companyId,
      action: "BANK_ACCOUNT_REJECTED",
      entityType: "supplier_bank_account",
      entityId: bankAccountId,
      before: {
        verificationStatus: BankAccountVerificationStatus.PENDING_VERIFICATION,
      },
      after: { verificationStatus: BankAccountVerificationStatus.REJECTED },
      reason,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
