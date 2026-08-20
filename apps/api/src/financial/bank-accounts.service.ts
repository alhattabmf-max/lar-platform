import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AuditActorType,
  BankAccountVerificationStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BankDataCryptoService } from "../common/security/bank-data-crypto.service";
import {
  normalizeIban,
  isValidSaudiIban,
  fingerprintIban,
  lastFourOf,
} from "../common/security/iban.util";
import { requireVerifiedSupplierCompany } from "./require-verified-supplier";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { SubmitBankAccountDto } from "./dto/submit-bank-account.dto";

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: BankDataCryptoService,
  ) {}

  /** Full history, newest first — SUPERSEDED/REJECTED rows are never hidden or deleted. */
  async listMine(companyId: string) {
    const rows = await this.prisma.supplierBankAccount.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toPublicShape(r));
  }

  async submit(dto: SubmitBankAccountDto, ctx: ActorContext) {
    await requireVerifiedSupplierCompany(this.prisma, ctx.companyId);

    const existingPending = await this.prisma.supplierBankAccount.findFirst({
      where: {
        companyId: ctx.companyId,
        verificationStatus: BankAccountVerificationStatus.PENDING_VERIFICATION,
      },
    });
    if (existingPending) {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        "A bank account submission is already pending review",
      );
    }

    const normalized = normalizeIban(dto.iban);
    if (!isValidSaudiIban(normalized)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Invalid Saudi IBAN format",
      );
    }

    let account;
    try {
      account = await this.prisma.supplierBankAccount.create({
        data: {
          companyId: ctx.companyId,
          accountHolderName: dto.accountHolderName.trim(),
          bankName: dto.bankName.trim(),
          ibanCiphertext: this.crypto.encrypt(normalized),
          ibanFingerprint: fingerprintIban(
            normalized,
            this.crypto.fingerprintKeyMaterial,
          ),
          ibanLast4: lastFourOf(normalized),
        },
      });
    } catch (error) {
      // The partial unique index is the final concurrency boundary: two requests
      // can both pass the read above, but only one may create a pending row.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "A bank account submission is already pending review",
        );
      }
      throw error;
    }

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "BANK_ACCOUNT_SUBMITTED",
      entityType: "supplier_bank_account",
      entityId: account.id,
      after: { bankName: account.bankName, ibanLast4: account.ibanLast4 },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toPublicShape(account);
  }

  async requireOwned(id: string, companyId: string) {
    const row = await this.prisma.supplierBankAccount.findFirst({
      where: { id, companyId },
    });
    if (!row) throw new NotFoundException("Bank account not found");
    return row;
  }

  private toPublicShape<
    T extends {
      id: string;
      companyId: string;
      accountHolderName: string;
      bankName: string;
      ibanLast4: string;
      verificationStatus: BankAccountVerificationStatus;
      rejectionReason: string | null;
      verifiedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
  >(row: T) {
    // Never include ibanCiphertext or ibanFingerprint in any
    // supplier-facing response — only last-4 is ever shown back.
    const {
      id,
      companyId,
      accountHolderName,
      bankName,
      ibanLast4,
      verificationStatus,
      rejectionReason,
      verifiedAt,
      createdAt,
      updatedAt,
    } = row;
    return {
      id,
      companyId,
      accountHolderName,
      bankName,
      ibanLast4,
      verificationStatus,
      rejectionReason,
      verifiedAt,
      createdAt,
      updatedAt,
    };
  }
}
