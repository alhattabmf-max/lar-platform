import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  AuditActorType,
  CompanyVerificationStatus,
  Prisma,
  UserStatus,
} from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { SessionService } from "../../common/security/session.service";
import { BusinessException } from "../../common/errors/business-exception";
import { CompanyDeletionEligibilityService } from "./company-deletion-eligibility.service";

/**
 * Administrative control over a company: suspend, reactivate, remove.
 *
 * SUSPENDING A COMPANY IS NOT A LOGIN RULE. The schema says so
 * explicitly — "a company being PENDING_VERIFICATION or SUSPENDED must
 * never be the mechanism that blocks a user's login; that gating
 * belongs here [UserStatus]" — so this moves the PEOPLE as well as the
 * company, and revokes their sessions. Leaving the company row alone
 * and only stopping logins would let an operator suspend an account
 * that goes on trading through a session opened five minutes earlier.
 *
 * REACTIVATION IS NOT "SET EVERYONE TO ACTIVE". A user suspended for a
 * reason of their own, or disabled, must not be reinstated by an
 * unrelated act. Which users the company's suspension moved — and what
 * to put them back to — is STORED on the row
 * (`statusBeforeCompanySuspension`), so lifting it is a lookup rather
 * than a guess.
 */

export interface CompanyActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class CompanyControlService {
  private readonly logger = new Logger(CompanyControlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly eligibility: CompanyDeletionEligibilityService,
  ) {}

  // ----- suspend / reactivate ---------------------------------------

  /**
   * Stops a company trading, and stops its people signing in.
   *
   * Only users the suspension is ALLOWED to move are moved: someone
   * already SUSPENDED or DISABLED is left exactly as they are, and is
   * not marked as having been moved by this — which is what makes
   * reactivation safe.
   */
  async suspend(companyId: string, reason: string, ctx: CompanyActorContext) {
    const movedUserIds = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company) throw new NotFoundException("Company not found");

      if (company.verificationStatus === CompanyVerificationStatus.SUSPENDED) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "Company is already suspended",
        );
      }

      const movable = await tx.user.findMany({
        where: { companyId, status: UserStatus.ACTIVE },
        select: { id: true, status: true },
      });

      for (const user of movable) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            status: UserStatus.SUSPENDED,
            // The value to put them back to, written now rather than
            // reconstructed later.
            statusBeforeCompanySuspension: user.status,
          },
        });
      }

      await tx.company.update({
        where: { id: companyId },
        data: { verificationStatus: CompanyVerificationStatus.SUSPENDED },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          companyId,
          action: "COMPANY_SUSPENDED",
          entityType: "company",
          entityId: companyId,
          before: { verificationStatus: company.verificationStatus },
          after: {
            verificationStatus: CompanyVerificationStatus.SUSPENDED,
            usersSuspended: movable.length,
          },
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return movable.map((user) => user.id);
    });

    // AFTER the commit: sessions live in Redis, which shares no
    // transaction with the database. Revoking first would sign people
    // out of a suspension that then failed to save.
    await this.revokeSessions(movedUserIds);

    return { usersSuspended: movedUserIds.length };
  }

  /**
   * Lets a company trade again, and returns ONLY the people it took.
   */
  async reactivate(companyId: string, ctx: CompanyActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company) throw new NotFoundException("Company not found");

      if (company.verificationStatus !== CompanyVerificationStatus.SUSPENDED) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "Company is not suspended",
        );
      }

      // Exactly the users this company's suspension moved. Anyone else
      // is untouched — including a user suspended for their own reason
      // while the company happened to be suspended too.
      const moved = await tx.user.findMany({
        where: { companyId, statusBeforeCompanySuspension: { not: null } },
        select: { id: true, statusBeforeCompanySuspension: true },
      });

      for (const user of moved) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            status: user.statusBeforeCompanySuspension as UserStatus,
            statusBeforeCompanySuspension: null,
          },
        });
      }

      // BACK TO VERIFIED IS NOT ASSUMED. A company suspended while it
      // was still pending returns to pending, not to verified — a
      // suspension is not a shortcut through verification.
      const restored = await this.previousVerification(tx, companyId);

      await tx.company.update({
        where: { id: companyId },
        data: { verificationStatus: restored },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          companyId,
          action: "COMPANY_REACTIVATED",
          entityType: "company",
          entityId: companyId,
          before: { verificationStatus: CompanyVerificationStatus.SUSPENDED },
          after: { verificationStatus: restored, usersRestored: moved.length },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { verificationStatus: restored, usersRestored: moved.length };
    });
  }

  /**
   * What the company was before it was suspended.
   *
   * Read from the audit entry this service wrote, because the company
   * row holds one status at a time. Absent or unreadable, it falls back
   * to PENDING_VERIFICATION — the state that grants nothing, which is
   * the safe direction to be wrong in.
   */
  private async previousVerification(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<CompanyVerificationStatus> {
    const entry = await tx.auditLog.findFirst({
      where: {
        entityType: "company",
        entityId: companyId,
        action: "COMPANY_SUSPENDED",
      },
      orderBy: { createdAt: "desc" },
      select: { beforeData: true },
    });

    const before = entry?.beforeData as { verificationStatus?: string } | null;
    const value = before?.verificationStatus;

    return value && value in CompanyVerificationStatus
      ? (value as CompanyVerificationStatus)
      : CompanyVerificationStatus.PENDING_VERIFICATION;
  }

  // ----- removal -----------------------------------------------------

  /**
   * Removes a company and everything that exists only because of it.
   *
   * THE ELIGIBILITY CHECK RUNS INSIDE THE TRANSACTION, not before it.
   * Checked outside, an order placed in the gap between the check and
   * the delete would be orphaned — and `master_orders` has no foreign
   * key to catch it.
   *
   * WHAT IS DELETED is everything that exists only because the company
   * does, and nothing else. The eligibility check has already proved
   * there is no order, no payment attempt and no product report, and
   * those three are what every financial record hangs from — so what
   * remains is the company's own paperwork.
   *
   * THE ORDER IS THE FOREIGN KEY ORDER, children before parents.
   * Twelve tables point at `companies` with ON DELETE RESTRICT and
   * several point at each other; getting this sequence wrong does not
   * corrupt anything — the transaction fails — but it fails in front
   * of an operator with a constraint name instead of a sentence.
   *
   * THE ACTIVE BANK ACCOUNT IS UNPOINTED FIRST. `companies` points at
   * `supplier_bank_accounts`, so the account cannot go while the
   * company still names it.
   */
  async remove(companyId: string, reason: string, ctx: CompanyActorContext) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          legalName: true,
          crNumber: true,
          accountType: true,
        },
      });
      if (!company) throw new NotFoundException("Company not found");

      const eligibility = await this.eligibility.check(companyId);
      if (!eligibility.allowed) {
        // The SERVER refuses, with the same answer the screen used to
        // disable its button. Calling the route directly changes
        // nothing.
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          `Company cannot be removed: ${eligibility.blockers
            .map((blocker) => `${blocker.kind}=${blocker.count}`)
            .join(", ")}`,
        );
      }

      const users = await tx.user.findMany({
        where: { companyId },
        select: { id: true },
      });
      const userIds = users.map((user) => user.id);

      // Children first, parents last: every one of these carries a
      // RESTRICT foreign key, so the order is the delete order.
      const removed = {
        notificationRecipients: (
          await tx.notificationRecipient.deleteMany({
            where: { userId: { in: userIds } },
          })
        ).count,
        notifications: (
          await tx.notification.deleteMany({ where: { companyId } })
        ).count,
        passwordResetTokens: (
          await tx.passwordResetToken.deleteMany({
            where: { userId: { in: userIds } },
          })
        ).count,
        emailVerificationTokens: (
          await tx.emailVerificationToken.deleteMany({
            where: { userId: { in: userIds } },
          })
        ).count,
        // A checkout and everything hanging off it. There is no
        // payment attempt — that is a blocker — so this is a lock
        // somebody abandoned and the quote it was priced from.
        quoteSnapshots: (
          await tx.quoteSnapshot.deleteMany({
            where: { checkoutSession: { traderCompanyId: companyId } },
          })
        ).count,
        checkoutLocationAllocations: (
          await tx.checkoutLocationAllocation.deleteMany({
            where: { checkoutSession: { traderCompanyId: companyId } },
          })
        ).count,
        checkoutSessions: (
          await tx.checkoutSession.deleteMany({
            where: { traderCompanyId: companyId },
          })
        ).count,

        // Safe only because a payment attempt is a blocker: an
        // attempt points at the acceptance in force when it was taken.
        policyAcceptances: (
          await tx.policyAcceptance.deleteMany({ where: { companyId } })
        ).count,

        opportunities: (
          await tx.opportunity.deleteMany({ where: { companyId } })
        ).count,
        productMedia: (
          await tx.productMedia.deleteMany({
            where: { product: { companyId } },
          })
        ).count,
        productApprovalSnapshots: (
          await tx.productApprovalSnapshot.deleteMany({
            where: { product: { companyId } },
          })
        ).count,
        products: (await tx.product.deleteMany({ where: { companyId } })).count,

        verificationRequests: (
          await tx.supplierVerificationRequest.deleteMany({
            where: { companyId },
          })
        ).count,

        // UNPOINTED, THEN DELETED. `companies.active_bank_account_id`
        // points at the account; it has to let go first.
        bankAccounts: await (async () => {
          await tx.company.update({
            where: { id: companyId },
            data: { activeBankAccountId: null },
          });
          return (
            await tx.supplierBankAccount.deleteMany({ where: { companyId } })
          ).count;
        })(),

        supplierTaxProfiles: (
          await tx.supplierTaxProfile.deleteMany({ where: { companyId } })
        ).count,
        traderTaxProfiles: (
          await tx.traderTaxProfile.deleteMany({ where: { companyId } })
        ).count,
        invoicingProfiles: (
          await tx.supplierInvoicingProfile.deleteMany({ where: { companyId } })
        ).count,
        contacts: (await tx.companyContact.deleteMany({ where: { companyId } }))
          .count,
        locations: (
          await tx.companyLocation.deleteMany({ where: { companyId } })
        ).count,
        users: (await tx.user.deleteMany({ where: { companyId } })).count,
      };

      await tx.company.delete({ where: { id: companyId } });

      // THE RECORD OUTLIVES THE COMPANY. `audit_logs.company_id` is a
      // plain column with no foreign key, so this line stays readable
      // after the row it names is gone — which is the whole reason a
      // removal can be permitted at all.
      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          companyId,
          action: "COMPANY_DELETED",
          entityType: "company",
          entityId: companyId,
          // Identity and counts only. No credential, no token, no
          // storage key — none of which is read here in the first place.
          before: {
            legalName: company.legalName,
            crNumber: company.crNumber,
            accountType: company.accountType,
          },
          after: { removed },
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { userIds, removed };
    });

    // Their sessions are meaningless now, but a live session id is a
    // live session id until it is dropped.
    await this.revokeSessions(outcome.userIds);

    return { removed: outcome.removed };
  }

  // ----- shared ------------------------------------------------------

  /**
   * Drops sessions, without letting Redis fail the operation.
   *
   * The database has already committed. Reporting a failure for work
   * that succeeded would be a lie, and the log names a COUNT rather
   * than an id — a warning stream carrying session ids would be a list
   * of live credentials.
   */
  private async revokeSessions(userIds: readonly string[]): Promise<void> {
    let failed = 0;
    for (const userId of userIds) {
      try {
        await this.sessions.revokeAllForUser(userId);
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      this.logger.warn(`Failed to revoke sessions for ${failed} user(s)`);
    }
  }
}
