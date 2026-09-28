import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  AccountType,
  AuditActorType,
  CompanyVerificationStatus,
  EmailVerificationStatus,
  Prisma,
  UserStatus,
} from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { SETTINGS_KEYS } from "../settings/settings-keys.constants";
import { PoliciesService } from "../policies/policies.service";
import { VerificationService } from "../verification/verification.service";
import { SessionService } from "../common/security/session.service";
import { hashPassword, verifyPassword } from "../common/security/argon2.util";
import { normaliseEmail } from "../common/security/email.util";
import { profileState } from "@platform/types";
import { generateToken, hashToken } from "../common/security/token.util";
import { BusinessException } from "../common/errors/business-exception";
import { identityConflictCode, conflictedColumns } from "./identity-conflict";
import { ERROR_CODES } from "@platform/types";
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from "../email/email-provider.interface";
import type { RegisterCompanyDto } from "./dto/register-company.dto";

interface RequestContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly policies: PoliciesService,
    private readonly verification: VerificationService,
    private readonly sessions: SessionService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  // ---------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------

  async registerTrader(dto: RegisterCompanyDto, ctx: RequestContext) {
    return this.registerCompany(dto, AccountType.TRADER, ctx);
  }

  async registerSupplier(dto: RegisterCompanyDto, ctx: RequestContext) {
    return this.registerCompany(dto, AccountType.SUPPLIER, ctx);
  }

  private async registerCompany(
    dto: RegisterCompanyDto,
    accountType: AccountType,
    ctx: RequestContext,
  ) {
    // Fail-closed: throws if any mandatory published policy is missing
    // from the acceptance list, or if there are zero mandatory
    // published policies configured at all.
    await this.policies.assertMandatoryPoliciesAccepted(
      dto.acceptedPolicyVersionIds,
    );

    // NO CITY IS CHECKED HERE, because none is asked for. Registration
    // opens an account; the branch — with its city, its address and its
    // coordinates — is added afterwards from "complete your profile",
    // and THAT path still validates the city exactly as this did.

    const passwordHash = await hashPassword(dto.password);
    const initialVerificationStatus =
      accountType === AccountType.TRADER
        ? CompanyVerificationStatus.VERIFIED
        : CompanyVerificationStatus.PENDING_VERIFICATION;

    let created: { companyId: string; userId: string };
    try {
      // Atomic: Company + Owner User + primary Contact + default
      // Location + Policy Acceptances all commit together, or none do.
      created = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            crNumber: dto.crNumber,
            legalName: dto.legalName,
            accountType,
            verificationStatus: initialVerificationStatus,
          },
        });

        // NORMALISED AT THE WRITE, not only in the DTO. The unique
        // index on `users.email` can only refuse a duplicate if every
        // row reaching it is spelled the same way, and this is the one
        // path that creates a login.
        const email = normaliseEmail(dto.email);

        const user = await tx.user.create({
          data: {
            companyId: company.id,
            email,
            passwordHash,
            primaryMobile1: dto.primaryMobile1,
            // NOT COLLECTED AT REGISTRATION ANY MORE, and the column is
            // NOT NULL, so the row records "none given" as an empty
            // string. Every reader already treats a blank as absent —
            // `company-detail.service.ts` skips it when listing the
            // company's phone numbers — so nothing displays a number
            // that was never provided.
            //
            // THIS IS AN INTERIM. The honest shape is a nullable
            // column, which is a migration; it is described in the
            // report rather than performed here.
            primaryMobile2: "",
          },
        });

        await tx.companyContact.create({
          data: {
            companyId: company.id,
            name: dto.legalName,
            phone: dto.primaryMobile1,
            email,
          },
        });

        // NO BRANCH IS CREATED. A company registers before it has
        // decided where it will operate from, and a row called "Main"
        // at coordinates somebody was made to type to get past a form
        // is an address nobody can be held to. The first branch is
        // added from "complete your profile".

        for (const versionId of dto.acceptedPolicyVersionIds) {
          await tx.policyAcceptance.create({
            data: {
              policyVersionId: versionId,
              companyId: company.id,
              userId: user.id,
              accountTypeSnapshot: accountType,
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            },
          });
        }

        return { companyId: company.id, userId: user.id };
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // THE REFUSAL NAMES THE FIELD, by the owner's decision.
        //
        // It used to answer identically for every identity — one code,
        // one sentence — so that registration could not be used to
        // discover which CR numbers and email addresses exist here. The
        // owner weighed that against a person who cannot tell which of
        // their four numbers was already taken, and chose the clearer
        // message. What answers the enumeration it opens is the rate
        // limit now on this endpoint, which it never carried while the
        // answer told an attacker nothing.
        //
        // STILL NO PRE-CHECK. The unique constraint decides, and two
        // concurrent requests for the same identity both land here — a
        // look-up first would be a second, racier oracle. And the field
        // is named from Prisma's `meta.target`, which reports COLUMNS
        // and never values, so no address or number is echoed back.
        const code = identityConflictCode(err);
        this.logger.warn(
          `Registration conflict on unique constraint [${conflictedColumns(err)}] — responding with ${code}`,
        );

        throw new BusinessException(409, code, "That identity is already registered");
      }
      throw err;
    }

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: created.userId,
      companyId: created.companyId,
      action: "COMPANY_REGISTERED",
      entityType: "company",
      entityId: created.companyId,
      after: { crNumber: dto.crNumber, accountType },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    if (accountType === AccountType.SUPPLIER) {
      await this.verification.evaluateOnRegistration(
        created.companyId,
        dto.crNumber,
        dto.legalName,
        ctx,
      );
    }

    const emailVerificationEnabled = await this.settings.getBoolean(
      SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED,
      false,
    );

    if (emailVerificationEnabled) {
      await this.issueEmailVerificationToken(
        created.userId,
        normaliseEmail(dto.email),
      );
    } else {
      // WAIVED (not VERIFIED) — this account never proved control of
      // the mailbox. If email_verification_enabled is later flipped
      // ON, a WAIVED user must keep logging in normally; only newly
      // PENDING users are gated.
      await this.prisma.user.update({
        where: { id: created.userId },
        data: { emailVerificationStatus: EmailVerificationStatus.WAIVED },
      });
    }

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: created.companyId },
    });

    return {
      companyId: created.companyId,
      userId: created.userId,
      accountType,
      verificationStatus: company.verificationStatus,
      emailVerificationEnabled,
    };
  }

  // ---------------------------------------------------------------
  // Login / Logout
  // ---------------------------------------------------------------

  async login(crNumber: string, password: string, ctx: RequestContext) {
    const company = await this.prisma.company.findUnique({
      where: { crNumber },
    });
    // Phase 2 always has exactly one OWNER; company.id is the durable
    // identity used from here on — crNumber was only the lookup key.
    const user = company
      ? await this.prisma.user.findFirst({
          where: { companyId: company.id, role: "OWNER" },
        })
      : null;

    // Constant-time-ish decoy: a real Argon2 verify runs even when
    // there is nothing to verify against, so a missing account — or an
    // UNCLAIMED one — does not respond measurably faster than a wrong
    // password.
    const DECOY_HASH =
      "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    // A NULL hash is an account that exists but has never been claimed —
    // imported from a spreadsheet and invited, with the person yet to
    // set a password. It is refused HERE, explicitly, rather than being
    // allowed to reach a comparison with nothing on the other side.
    const passwordOk =
      user && user.passwordHash !== null
        ? await verifyPassword(user.passwordHash, password)
        : await verifyPassword(DECOY_HASH, password);

    if (!company || !user || user.passwordHash === null || !passwordOk) {
      await this.audit.log({
        actorType: AuditActorType.USER,
        action: "USER_LOGIN_FAILED",
        entityType: "company",
        entityId: company?.id ?? "unknown",
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new BusinessException(
        401,
        ERROR_CODES.INVALID_CREDENTIALS,
        "Invalid CR number or password",
      );
    }

    // User authentication status gates login — company commercial
    // verification/suspension status must NEVER be the mechanism that
    // blocks a user from logging in.
    if (user.status !== UserStatus.ACTIVE) {
      throw new BusinessException(
        403,
        ERROR_CODES.FORBIDDEN,
        "This account is not active",
      );
    }

    if (user.emailVerificationStatus === EmailVerificationStatus.PENDING) {
      throw new BusinessException(
        403,
        ERROR_CODES.EMAIL_VERIFICATION_REQUIRED,
        "Email verification is required before logging in",
      );
    }

    const sessionId = await this.sessions.create({
      userId: user.id,
      companyId: company.id,
      accountType: company.accountType,
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: user.id,
      companyId: company.id,
      action: "USER_LOGIN_SUCCESS",
      entityType: "user",
      entityId: user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      sessionId,
      userId: user.id,
      companyId: company.id,
      accountType: company.accountType,
    };
  }

  async logout(
    sessionId: string,
    userId: string,
    companyId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: userId,
      companyId,
      action: "USER_LOGOUT",
      entityType: "user",
      entityId: userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // ---------------------------------------------------------------
  // Password recovery
  // ---------------------------------------------------------------

  async forgotPassword(email: string, ctx: RequestContext): Promise<void> {
    // The SAME shape the row was stored in, or the lookup misses an
    // account that exists and the reset silently goes nowhere.
    const user = await this.prisma.user.findUnique({
      where: { email: normaliseEmail(email) },
    });

    // Always audit the request itself, but only issue a token if the
    // account exists — the HTTP response is identical either way
    // (enumeration protection lives in the controller).
    if (user) {
      const rawToken = generateToken();
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
        },
      });

      await this.emailProvider.sendEmail({
        to: user.email,
        subject: "Reset your password",
        htmlBody: `<p>Use this token to reset your password: ${rawToken}</p>`,
      });

      await this.audit.log({
        actorType: AuditActorType.USER,
        actorId: user.id,
        companyId: user.companyId,
        action: "PASSWORD_RESET_REQUESTED",
        entityType: "user",
        entityId: user.id,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!token || token.consumedAt || token.expiresAt < new Date()) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Invalid or expired token",
      );
    }

    // Atomic, idempotent consumption: only succeeds if still
    // unconsumed at the moment of the UPDATE, closing the
    // race window between two concurrent uses of the same token.
    const consumed = await this.prisma.passwordResetToken.updateMany({
      where: { id: token.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Invalid or expired token",
      );
    }

    const passwordHash = await hashPassword(newPassword);
    const user = await this.prisma.user.update({
      where: { id: token.userId },
      data: { passwordHash },
    });

    // Changing a credential invalidates every previously issued
    // session for this user, without exception.
    await this.sessions.revokeAllForUser(user.id);

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: user.id,
      companyId: user.companyId,
      action: "PASSWORD_RESET_COMPLETED",
      entityType: "user",
      entityId: user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // ---------------------------------------------------------------
  // Email verification
  // ---------------------------------------------------------------

  private async issueEmailVerificationToken(
    userId: string,
    email: string,
  ): Promise<void> {
    const rawToken = generateToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      },
    });

    await this.emailProvider.sendEmail({
      to: email,
      subject: "Verify your email",
      htmlBody: `<p>Use this token to verify your email: ${rawToken}</p>`,
    });
  }

  /**
   * THE ADDRESS A COMPANY IS REACHED ON, changed by the company itself.
   *
   * WHY THIS EXISTS. «بيانات المنشأة» shows the email, and until now it
   * could only show it: there was no endpoint behind the field, so an
   * account created with a typo in its address had no way to fix it
   * short of an administrator. The field is editable there now, and
   * this is what stands behind it.
   *
   * THE NEW ADDRESS IS UNVERIFIED, and that is the whole point rather
   * than an inconvenience: proving control of the OLD mailbox says
   * nothing about the new one. The status goes back to PENDING and a
   * fresh token is issued — unless verification is switched off
   * platform-wide, in which case it becomes WAIVED exactly as a new
   * registration's would, so a company is never left holding a PENDING
   * status that nothing in the platform will ever clear.
   *
   * A TAKEN ADDRESS IS REFUSED NEUTRALLY. `users.email` is unique, and
   * the answer says the address cannot be used rather than confirming
   * that somebody else holds it — the same reticence registration
   * shows, for the same reason.
   *
   * THE SAME ADDRESS IS A NO-OP. Re-submitting what is already stored
   * must not reset a verified status to PENDING and post a token for
   * a mailbox that was already proved.
   */
  async changeEmail(
    userId: string,
    rawEmail: string,
    ctx: RequestContext,
  ): Promise<{ email: string; emailVerificationStatus: EmailVerificationStatus }> {
    const email = normaliseEmail(rawEmail);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    if (user.email === email) {
      return {
        email: user.email,
        emailVerificationStatus: user.emailVerificationStatus,
      };
    }

    const emailVerificationEnabled = await this.settings.getBoolean(
      SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED,
      false,
    );
    const nextStatus = emailVerificationEnabled
      ? EmailVerificationStatus.PENDING
      : EmailVerificationStatus.WAIVED;

    let updated;
    try {
      updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          email,
          emailVerificationStatus: nextStatus,
          emailVerifiedAt: null,
        },
      });
    } catch (error) {
      // The unique index is the boundary: two requests can both read a
      // free address, and only one may take it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // NAMED, like registration. The person is signed in and
        // editing their own record: telling them the address belongs
        // to somebody reveals nothing they could not learn by trying
        // to register it, and leaving it vague only makes them guess.
        throw new BusinessException(
          409,
          identityConflictCode(error),
          "That identity is already registered",
        );
      }
      throw error;
    }

    if (emailVerificationEnabled) {
      await this.issueEmailVerificationToken(updated.id, email);
    }

    // THE ADDRESSES ARE NOT IN THE RECORD. An audit row is read by
    // administrators and exported; what changed is that the address
    // changed, and by whom.
    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: updated.id,
      companyId: updated.companyId,
      action: "USER_EMAIL_CHANGED",
      entityType: "user",
      entityId: updated.id,
      after: { emailVerificationStatus: nextStatus },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      email: updated.email,
      emailVerificationStatus: updated.emailVerificationStatus,
    };
  }

  async resendVerificationEmail(
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (user.emailVerificationStatus !== EmailVerificationStatus.PENDING) {
      return; // Nothing to do — already verified or waived.
    }
    await this.issueEmailVerificationToken(user.id, user.email);

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: user.id,
      companyId: user.companyId,
      action: "EMAIL_VERIFICATION_RESENT",
      entityType: "user",
      entityId: user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async verifyEmail(rawToken: string, ctx: RequestContext): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const token = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!token || token.consumedAt || token.expiresAt < new Date()) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Invalid or expired token",
      );
    }

    const consumed = await this.prisma.emailVerificationToken.updateMany({
      where: { id: token.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Invalid or expired token",
      );
    }

    const user = await this.prisma.user.update({
      where: { id: token.userId },
      data: {
        emailVerificationStatus: EmailVerificationStatus.VERIFIED,
        emailVerifiedAt: new Date(),
      },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: user.id,
      companyId: user.companyId,
      action: "EMAIL_VERIFIED",
      entityType: "user",
      entityId: user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /**
   * The signed-in user, their company, and whether the profile step is
   * finished.
   *
   * COUNTED, NOT LOADED. The caller needs to know IF there is a branch,
   * never which one — and pulling a company's whole branch list into
   * every session read would be a query that grows with a fact nobody
   * asked for.
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        company: {
          include: {
            _count: { select: { locations: true, bankAccounts: true } },
            // Read rather than counted: "does it exist" is not enough
            // here — an unanswered VAT question is a row that exists
            // and is not finished.
            invoicingProfile: { select: { invoicingLegalName: true } },
            taxProfile: { select: { isVatRegistered: true, vatNumber: true } },
          },
        },
      },
    });

    /**
     * COUNTED, NOT REMEMBERED. Every requirement is a row that either
     * exists or does not, read on this request — so the badge beside
     * «بيانات المنشأة» cannot disagree with the section it points at.
     *
     * WHICH requirements apply is `requirementsFor`, shared with the
     * portal: a buyer is never asked for a bank account, because
     * nothing is ever paid out to one.
     */
    const profile = profileState(user.company.accountType, {
      hasCompanyDetails:
        user.company.legalName.trim() !== "" &&
        user.company.crNumber.trim() !== "" &&
        user.primaryMobile1.trim() !== "",
      hasMainBranch: user.company._count.locations > 0,
      hasBankAccount: user.company._count.bankAccounts > 0,
      // BOTH ROWS, AND A COMPLETE VAT ANSWER. A billing name with the
      // VAT question unanswered is half a card, and half an answer in
      // the "done" column is what makes a badge disagree with the form
      // it points at. Always false for a buyer, whose list does not
      // carry this requirement at all.
      hasBillingIdentity:
        (user.company.invoicingProfile?.invoicingLegalName.trim() ?? "") !== "" &&
        user.company.taxProfile !== null &&
        (!user.company.taxProfile.isVatRegistered ||
          (user.company.taxProfile.vatNumber ?? "").trim() !== ""),
    });

    return { ...user, profile };
  }
}
