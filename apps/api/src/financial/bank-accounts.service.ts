import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AuditActorType,
  BankAccountVerificationStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { SupplierVerificationRequestService } from "../verification/supplier-verification-request.service";
import { AuditService } from "../audit/audit.service";
import { BankDataCryptoService } from "../common/security/bank-data-crypto.service";
import {
  normalizeIban,
  isValidSaudiIban,
  bankFromIban,
  fingerprintIban,
  lastFourOf,
} from "../common/security/iban.util";
import { requireSupplierCompany } from "./require-verified-supplier";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { SubmitBankAccountDto } from "./dto/submit-bank-account.dto";

/**
 * What is stored when the IBAN's bank code is not in the table.
 *
 * A VALUE, NOT AN EMPTY STRING, because this column is read straight
 * into a supplier's card, an admin's review screen and a payout email,
 * and none of those should render a blank where a bank belongs. It is
 * a constant so it can be found, and so a later table update can be
 * matched against the rows that were written before it.
 */
export const UNIDENTIFIED_BANK = "بنك غير معروف";

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
    private readonly verificationRequests: SupplierVerificationRequestService,
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
    // A SUPPLIER, APPROVED OR NOT. The bank account is one of the
    // things the approval reviews, so requiring approval to enter it
    // was a circle: the admin could not see the payout details it was
    // asked to approve, and the supplier was waiting on an approval
    // that was waiting on them.
    //
    // Every other rule on this path is untouched — the IBAN is still
    // validated, still encrypted, still fingerprinted, and only one
    // submission may be pending at a time.
    await requireSupplierCompany(this.prisma, ctx.companyId);
    // CLOSED WHILE THE REVIEW IS OPEN. The account is one of the things
    // being reviewed; changing it mid-review would mean approving
    // details nobody looked at.
    await this.verificationRequests.assertNotUnderReview(ctx.companyId);

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

    // THE BANK IS READ OUT OF THE NUMBER, never taken from the caller.
    // An unrecognised code is NOT a reason to refuse a well-formed
    // IBAN — the table can lag a new entrant, and a lagging table must
    // not be able to stop a supplier being paid. The row records that
    // nobody identified it, which is what the reviewer needs to see.
    const bank = bankFromIban(normalized);

    let account;
    try {
      account = await this.prisma.supplierBankAccount.create({
        data: {
          companyId: ctx.companyId,
          accountHolderName: dto.accountHolderName.trim(),
          bankName: bank?.nameAr ?? UNIDENTIFIED_BANK,
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

    // AND A VERIFIED SUPPLIER LOSES THAT STATUS UNTIL IT IS REVIEWED
    // AGAIN. Where the money goes is the one field the approval is
    // most about; changing it after approval and staying approved
    // was the hole this closes. The account just written is PENDING
    // and does NOT become the active one — payouts in flight keep
    // going to the account that was verified.
    await this.verificationRequests.markChangedSinceApproval(
      ctx.companyId,
      "BANK_ACCOUNT",
      ctx,
    );

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
