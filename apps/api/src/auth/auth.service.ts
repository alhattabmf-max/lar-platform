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
import { generateToken, hashToken } from "../common/security/token.util";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { EMAIL_PROVIDER, type EmailProvider } from "../email/email-provider.interface";
import { SENTINEL_CITY_ID } from "../geography/sentinel.constants";
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
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider
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
    ctx: RequestContext
  ) {
    // Fail-closed: throws if any mandatory published policy is missing
    // from the acceptance list, or if there are zero mandatory
    // published policies configured at all.
    await this.policies.assertMandatoryPoliciesAccepted(dto.acceptedPolicyVersionIds);

    // Service-level city validation — never trusts the DTO's UUID
    // shape alone. Explicitly rejects the Sentinel (reserved for
    // migrating pre-existing rows, never selectable at registration).
    if (dto.cityId === SENTINEL_CITY_ID) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "This city cannot be selected — please choose a valid city"
      );
    }
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
    if (!city || !city.isActive) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or inactive city");
    }

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

        const user = await tx.user.create({
          data: {
            companyId: company.id,
            email: dto.email,
            passwordHash,
            primaryMobile1: dto.primaryMobile1,
            primaryMobile2: dto.primaryMobile2,
          },
        });

        await tx.companyContact.create({
          data: {
            companyId: company.id,
            name: dto.legalName,
            phone: dto.primaryMobile1,
            email: dto.email,
          },
        });

        await tx.companyLocation.create({
          data: {
            companyId: company.id,
            cityId: dto.cityId,
            name: "Main",
            shortAddress: dto.shortAddress,
            latitude: dto.latitude,
            longitude: dto.longitude,
            contactName: dto.legalName,
            contactPhone: dto.primaryMobile1,
            isDefault: true,
          },
        });

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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // EVERY identity conflict — commercial registration number,
        // email, or any future login identifier — produces one
        // identical response: same status, same code, same body, same
        // message.
        //
        // Distinguishing them would be an enumeration oracle: an
        // attacker could submit registrations and read back which CR
        // numbers and email addresses already exist on the platform.
        // The same reasoning already governs /auth/password/forgot,
        // which answers identically whether or not the address is
        // known.
        //
        // This is also the ONLY conflict path. There is deliberately no
        // pre-check that looks up the CR or email first: a pre-check
        // would be a second, racier oracle answering the same question.
        // The unique constraint decides, and two concurrent requests
        // for the same identity both land here.
        //
        // The precise column is recorded server-side only. Prisma's
        // `meta.target` names COLUMNS, never values, so no email
        // address or CR number reaches the log.
        const target = err.meta?.target;
        const conflictedColumns = Array.isArray(target) ? target.join(",") : String(target ?? "");
        this.logger.warn(
          `Registration conflict on unique constraint [${conflictedColumns}] — responding with the neutral REGISTRATION_CONFLICT`
        );

        throw new BusinessException(
          409,
          ERROR_CODES.REGISTRATION_CONFLICT,
          "Registration could not be completed with these details"
        );
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
        ctx
      );
    }

    const emailVerificationEnabled = await this.settings.getBoolean(
      SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED,
      false
    );

    if (emailVerificationEnabled) {
      await this.issueEmailVerificationToken(created.userId, dto.email);
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
    const company = await this.prisma.company.findUnique({ where: { crNumber } });
    // Phase 2 always has exactly one OWNER; company.id is the durable
    // identity used from here on — crNumber was only the lookup key.
    const user = company
      ? await this.prisma.user.findFirst({ where: { companyId: company.id, role: "OWNER" } })
      : null;

    const passwordOk = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyPassword(
          // Constant-time-ish decoy: run a real Argon2 verify even when
          // there is no such user, so a missing account doesn't respond
          // measurably faster than a wrong password.
          "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          password
        );

    if (!company || !user || !passwordOk) {
      await this.audit.log({
        actorType: AuditActorType.USER,
        action: "USER_LOGIN_FAILED",
        entityType: "company",
        entityId: company?.id ?? "unknown",
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new BusinessException(401, ERROR_CODES.INVALID_CREDENTIALS, "Invalid CR number or password");
    }

    // User authentication status gates login — company commercial
    // verification/suspension status must NEVER be the mechanism that
    // blocks a user from logging in.
    if (user.status !== UserStatus.ACTIVE) {
      throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "This account is not active");
    }

    if (user.emailVerificationStatus === EmailVerificationStatus.PENDING) {
      throw new BusinessException(
        403,
        ERROR_CODES.EMAIL_VERIFICATION_REQUIRED,
        "Email verification is required before logging in"
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

    return { sessionId, userId: user.id, companyId: company.id, accountType: company.accountType };
  }

  async logout(sessionId: string, userId: string, companyId: string, ctx: RequestContext): Promise<void> {
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
    const user = await this.prisma.user.findUnique({ where: { email } });

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

  async resetPassword(rawToken: string, newPassword: string, ctx: RequestContext): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const token = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!token || token.consumedAt || token.expiresAt < new Date()) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or expired token");
    }

    // Atomic, idempotent consumption: only succeeds if still
    // unconsumed at the moment of the UPDATE, closing the
    // race window between two concurrent uses of the same token.
    const consumed = await this.prisma.passwordResetToken.updateMany({
      where: { id: token.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or expired token");
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

  private async issueEmailVerificationToken(userId: string, email: string): Promise<void> {
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

  async resendVerificationEmail(userId: string, ctx: RequestContext): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
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
    const token = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

    if (!token || token.consumedAt || token.expiresAt < new Date()) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or expired token");
    }

    const consumed = await this.prisma.emailVerificationToken.updateMany({
      where: { id: token.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or expired token");
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

  async getMe(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { company: true },
    });
  }
}
