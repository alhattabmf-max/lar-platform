import { Injectable } from "@nestjs/common";
import {
  AccountType,
  AuditActorType,
  BankAccountVerificationStatus,
  CompanyVerificationStatus,
  Prisma,
  SupplierVerificationRequestStatus,
} from "@prisma/client";
import {
  ERROR_CODES,
  profileState,
  supplierVerificationView,
  type LatestVerificationRequest,
  type SupplierReverificationTrigger,
  type SupplierVerificationView,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { FinancialSettingsService } from "../settings/financial-settings.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";

interface ActorContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * A supplier asking for its whole record to be reviewed, once.
 *
 * ONE REQUEST, ONE DECISION. Everything the platform needs from a
 * supplier — its details, its main branch, its bank account — is
 * reviewed together. The bank account used to carry its own approval,
 * which meant two queues, two decisions and a supplier who could be
 * half-approved with no way to tell what that meant.
 *
 * APPROVING A REQUEST IS THE ONLY PATH TO `VERIFIED`. Adding a bank
 * account does not do it, completing the record does not do it, and no
 * alert or shortcut does it. That is asserted from the source in
 * `supplier-gating.spec.ts` as well as tested here.
 *
 * EVERY DECISION IS ONE TRANSACTION over the SAME request row, read
 * with `FOR UPDATE`. Two administrators pressing approve and reject at
 * the same moment must not produce a company that is verified with a
 * rejected request behind it — the second one finds the row already
 * decided and is refused.
 */
@Injectable()
export class SupplierVerificationRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly financialSettings: FinancialSettingsService,
  ) {}

  // -----------------------------------------------------------------
  // Reading
  // -----------------------------------------------------------------

  /**
   * Where this company stands, as the portal and the submit guard both
   * read it.
   *
   * The completeness half comes from `profileState`, the same function
   * that decides the «غير مكتملة» badge — so the button and the badge
   * cannot disagree about whether anything is missing.
   */
  async viewFor(companyId: string): Promise<SupplierVerificationView> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: {
        _count: { select: { locations: true, bankAccounts: true } },
        // Read rather than counted: an unanswered VAT question is a
        // row that exists and is not finished.
        invoicingProfile: { select: { invoicingLegalName: true } },
        taxProfile: { select: { isVatRegistered: true, vatNumber: true } },
        users: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { primaryMobile1: true },
        },
      },
    });

    const latest = await this.latestRequest(companyId);

    const profile = profileState(company.accountType, {
      hasCompanyDetails:
        company.legalName.trim() !== "" &&
        company.crNumber.trim() !== "" &&
        (company.users[0]?.primaryMobile1.trim() ?? "") !== "",
      hasMainBranch: company._count.locations > 0,
      hasBankAccount: company._count.bankAccounts > 0,
      // BOTH ROWS, AND A COMPLETE VAT ANSWER. A billing name with the
      // VAT question unanswered is half a card, and half an answer in
      // the "done" column is what makes a badge disagree with the form
      // it points at. Always false for a buyer, whose list does not
      // carry this requirement at all.
      hasBillingIdentity:
        (company.invoicingProfile?.invoicingLegalName.trim() ?? "") !== "" &&
        company.taxProfile !== null &&
        (!company.taxProfile.isVatRegistered ||
          (company.taxProfile.vatNumber ?? "").trim() !== ""),
    });

    return supplierVerificationView({
      companyStatus: company.verificationStatus,
      latestRequest: latest,
      profileComplete: profile.complete,
    });
  }

  /**
   * A VERIFIED SUPPLIER CHANGED SOMETHING THE APPROVAL RESTED ON.
   *
   * «في كل الحالات، أي تعديل لازم يكون فيه إعادة إرسال توثيق.»
   *
   * IT MARKS; IT DOES NOT LOCK. The company leaves VERIFIED and
   * lands back in PENDING_VERIFICATION, which is the state a
   * supplier is in before their first approval: the record stays
   * fully editable, so somebody correcting two things is not shut
   * out after the first — «لو بغى يعدّل شغلتين». What closes the
   * record is SUBMITTING the request, not making the change.
   *
   * WHAT LEAVING VERIFIED ACTUALLY COSTS, measured rather than
   * assumed — every reader of this column was checked:
   *
   *   it STOPS  publishing a new offer, and submitting a product
   *             for approval;
   *   it LEAVES  the supplier's login, every offer already
   *             published, every order already placed, every
   *             payment and every settlement untouched. The
   *             payment path checks the BANK ACCOUNT's status,
   *             not the company's, and a newly submitted account
   *             does not become the active one until the request
   *             is approved — so money in flight keeps flowing to
   *             the account that was verified.
   *
   * ONLY A SUPPLIER, and only one that is currently VERIFIED. A
   * buyer is registered VERIFIED and never reviewed, so it must
   * never be dragged into this; and a company that is already
   * pending, returned or rejected has nothing to lose.
   */
  async markChangedSinceApproval(
    companyId: string,
    trigger: SupplierReverificationTrigger,
    ctx: ActorContext,
  ): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { accountType: true, verificationStatus: true },
    });
    if (!company) return;
    if (company.accountType !== AccountType.SUPPLIER) return;
    if (company.verificationStatus !== CompanyVerificationStatus.VERIFIED) {
      return;
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
      },
    });

    await this.audit.log({
      actorType: AuditActorType.SYSTEM,
      companyId,
      action: "COMPANY_REVERIFICATION_REQUIRED",
      entityType: "company",
      entityId: companyId,
      before: {
        verificationStatus: CompanyVerificationStatus.VERIFIED,
      },
      after: {
        verificationStatus:
          CompanyVerificationStatus.PENDING_VERIFICATION,
        trigger,
      },
      reason: `Verified supplier changed ${trigger}`,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /** Whether the data under review is closed to edits right now. */
  async isLocked(companyId: string): Promise<boolean> {
    const open = await this.prisma.supplierVerificationRequest.findFirst({
      where: {
        companyId,
        status: SupplierVerificationRequestStatus.UNDER_REVIEW,
      },
      select: { id: true },
    });
    return open !== null;
  }

  /**
   * Refuses a write while a request is open.
   *
   * SHARED BY EVERY EDITABLE PART OF THE RECORD — the branch, the
   * contact, the bank account. One helper, so a section added later
   * cannot quietly stay editable through a review.
   */
  async assertNotUnderReview(companyId: string): Promise<void> {
    if (await this.isLocked(companyId)) {
      throw new BusinessException(
        409,
        ERROR_CODES.VERIFICATION_UNDER_REVIEW,
        "Your verification request is being reviewed; these details cannot be changed until it is decided",
      );
    }
  }

  private async latestRequest(
    companyId: string,
  ): Promise<LatestVerificationRequest | null> {
    const row = await this.prisma.supplierVerificationRequest.findFirst({
      where: { companyId },
      // NEWEST FIRST, terminating in id: two requests written in the
      // same millisecond must not swap places between reads.
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    });

    if (!row) return null;

    return {
      id: row.id,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionReason: row.decisionReason,
    };
  }

  // -----------------------------------------------------------------
  // The supplier's side
  // -----------------------------------------------------------------

  /**
   * Send the record for review.
   *
   * REFUSED WHILE ANYTHING IS MISSING, and the refusal names what — a
   * supplier told only "incomplete" has to hunt for the form.
   *
   * The database has the last word: a partial unique index allows one
   * `UNDER_REVIEW` row per company, so two submissions that both saw
   * none cannot both create one.
   */
  async submit(companyId: string, userId: string, ctx: ActorContext) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    if (company.accountType !== AccountType.SUPPLIER) {
      throw new BusinessException(
        403,
        ERROR_CODES.FORBIDDEN,
        "Only supplier accounts are verified this way",
      );
    }

    const view = await this.viewFor(companyId);
    if (!view.canSubmit) {
      throw new BusinessException(
        409,
        ERROR_CODES.VERIFICATION_NOT_SUBMITTABLE,
        `A verification request cannot be sent from state ${view.state}`,
      );
    }

    try {
      const created = await this.prisma.supplierVerificationRequest.create({
        data: { companyId, submittedByUserId: userId },
      });

      await this.audit.log({
        actorType: AuditActorType.USER,
        actorId: userId,
        companyId,
        action: "SUPPLIER_VERIFICATION_REQUESTED",
        entityType: "supplier_verification_request",
        entityId: created.id,
        after: { status: created.status },
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return created;
    } catch (error) {
      // THE INDEX WON. Two submissions raced; the loser is told the
      // truth rather than a database error.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BusinessException(
          409,
          ERROR_CODES.VERIFICATION_NOT_SUBMITTABLE,
          "A verification request is already under review",
        );
      }
      throw error;
    }
  }

  // -----------------------------------------------------------------
  // The administrator's side
  // -----------------------------------------------------------------

  /** Approve the open request — and, with it, the company. */
  async approve(companyId: string, adminUserId: string, ctx: ActorContext) {
    return this.decide(companyId, adminUserId, ctx, {
      status: SupplierVerificationRequestStatus.APPROVED,
      action: "SUPPLIER_VERIFICATION_APPROVED",
      companyStatus: CompanyVerificationStatus.VERIFIED,
      reason: null,
    });
  }

  /** Send it back with what is wrong. The record reopens for editing. */
  async returnForCompletion(
    companyId: string,
    adminUserId: string,
    reason: string,
    ctx: ActorContext,
  ) {
    return this.decide(companyId, adminUserId, ctx, {
      status: SupplierVerificationRequestStatus.RETURNED_FOR_COMPLETION,
      action: "SUPPLIER_VERIFICATION_RETURNED",
      // THE COMPANY DOES NOT MOVE. It was never verified, and a return
      // is not a refusal — it stays where it was, and the supplier can
      // fix and resubmit.
      companyStatus: null,
      reason,
    });
  }

  /** Refuse it. Terminal for the supplier. */
  async reject(
    companyId: string,
    adminUserId: string,
    reason: string,
    ctx: ActorContext,
  ) {
    return this.decide(companyId, adminUserId, ctx, {
      status: SupplierVerificationRequestStatus.REJECTED,
      action: "SUPPLIER_VERIFICATION_REJECTED",
      companyStatus: CompanyVerificationStatus.REJECTED,
      reason,
    });
  }

  /**
   * One decision, one transaction, on the request that is actually open.
   *
   * THE ROW IS LOCKED BEFORE IT IS READ. Two administrators deciding at
   * the same moment would otherwise both see an open request and both
   * write — leaving a company verified with a rejected request behind
   * it, or the reverse. `FOR UPDATE` makes the second one wait and then
   * find the request already decided.
   *
   * THE COMPANY MOVES IN THE SAME TRANSACTION as the request, so there
   * is no instant at which one says approved and the other does not.
   */
  private async decide(
    companyId: string,
    adminUserId: string,
    ctx: ActorContext,
    decision: {
      status: SupplierVerificationRequestStatus;
      action: string;
      companyStatus: CompanyVerificationStatus | null;
      reason: string | null;
    },
  ) {
    // READ BEFORE THE TRANSACTION. A settings lookup inside one holds
    // the row lock open for the length of an unrelated query.
    const payoutHoldDays =
      decision.status === SupplierVerificationRequestStatus.APPROVED
        ? await this.financialSettings.getPayoutHoldDays()
        : null;

    const needsReason =
      decision.status ===
        SupplierVerificationRequestStatus.RETURNED_FOR_COMPLETION ||
      decision.status === SupplierVerificationRequestStatus.REJECTED;

    if (needsReason && (decision.reason ?? "").trim() === "") {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "A reason is required so the supplier knows what to do next",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const [open] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM supplier_verification_requests
        WHERE company_id = ${companyId}::uuid
          AND status = 'UNDER_REVIEW'
        FOR UPDATE
      `;

      if (!open) {
        throw new BusinessException(
          409,
          ERROR_CODES.VERIFICATION_NOT_UNDER_REVIEW,
          "There is no verification request under review for this company",
        );
      }

      const updated = await tx.supplierVerificationRequest.update({
        where: { id: open.id },
        data: {
          status: decision.status,
          decidedByAdminId: adminUserId,
          decidedAt: new Date(),
          decisionReason: decision.reason?.trim() ?? null,
        },
      });

      // THE ACCOUNT IS PART OF WHAT WAS APPROVED, so it is activated
      // here rather than by a second decision. This is the same work
      // the removed `admin/bank-accounts/:id/approve` did, moved and
      // not changed: the account becomes VERIFIED, any previous one
      // is SUPERSEDED, the company points at it, and the payout hold
      // starts. Without it an approved supplier would have no
      // `activeBankAccountId` and could never be paid at all.
      if (payoutHoldDays !== null) {
        await this.activateBankAccount(tx, companyId, payoutHoldDays);
      }

      let companyBefore: CompanyVerificationStatus | null = null;
      if (decision.companyStatus !== null) {
        const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
          select: { verificationStatus: true },
        });
        companyBefore = company.verificationStatus;

        await tx.company.update({
          where: { id: companyId },
          data: { verificationStatus: decision.companyStatus },
        });
      }

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: adminUserId,
          companyId,
          action: decision.action,
          entityType: "supplier_verification_request",
          entityId: open.id,
          before: {
            status: SupplierVerificationRequestStatus.UNDER_REVIEW,
            ...(companyBefore ? { verificationStatus: companyBefore } : {}),
          },
          after: {
            status: decision.status,
            ...(decision.companyStatus
              ? { verificationStatus: decision.companyStatus }
              : {}),
          },
          reason: decision.reason ?? undefined,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Turn the reviewed account into the one the platform pays.
   *
   * MOVED, NOT REWRITTEN. Every step here was previously done by the
   * standalone bank-account approval; the money rules — which
   * account is active, when the payout hold expires, what happens to
   * the one it replaces — are untouched. Only the trigger changed,
   * from a second administrator decision to the one that approves
   * the supplier.
   */
  private async activateBankAccount(
    tx: Prisma.TransactionClient,
    companyId: string,
    payoutHoldDays: number,
  ): Promise<void> {
    const pending = await tx.supplierBankAccount.findFirst({
      where: {
        companyId,
        verificationStatus: BankAccountVerificationStatus.PENDING_VERIFICATION,
      },
      select: { id: true },
    });

    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { activeBankAccountId: true },
    });

    if (!pending) {
      // Nothing new to activate. That is fine ONLY if the supplier
      // already has an account we pay into — otherwise approving
      // would produce a verified supplier who cannot receive money,
      // and it is better to refuse than to create that.
      if (company.activeBankAccountId) return;
      throw new BusinessException(
        409,
        ERROR_CODES.VERIFICATION_NOT_SUBMITTABLE,
        "This supplier has no bank account to approve",
      );
    }

    await tx.supplierBankAccount.update({
      where: { id: pending.id },
      data: {
        verificationStatus: BankAccountVerificationStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });

    if (
      company.activeBankAccountId &&
      company.activeBankAccountId !== pending.id
    ) {
      await tx.supplierBankAccount.update({
        where: { id: company.activeBankAccountId },
        data: { verificationStatus: BankAccountVerificationStatus.SUPERSEDED },
      });
    }

    await tx.company.update({
      where: { id: companyId },
      data: {
        activeBankAccountId: pending.id,
        payoutHoldUntil: new Date(
          Date.now() + payoutHoldDays * 24 * 60 * 60 * 1000,
        ),
      },
    });
  }
}
