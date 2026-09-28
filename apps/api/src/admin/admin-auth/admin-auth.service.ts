import { Inject, Injectable } from "@nestjs/common";
import { AuditActorType, AdminUserStatus } from "@prisma/client";
import type { Env } from "@platform/config";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { APP_ENV } from "../../config/app-config.module";
import { SecuritySettingsService } from "../../settings/security-settings.service";
import { DynamicRateLimiter } from "../../common/security/dynamic-rate-limiter";
import { hashPassword, verifyPassword } from "../../common/security/argon2.util";
import { hashToken } from "../../common/security/token.util";
import { encryptSecret, decryptSecret } from "../../common/security/crypto.util";
import { generateTotpEnrollment, verifyTotpCode } from "../../common/security/totp.util";
import { generateRecoveryCodes } from "../../common/security/recovery-codes.util";
import { AdminSessionService } from "./admin-session.service";
import { AdminLoginTicketService, type LoginTicketData } from "./admin-login-ticket.service";
import { BusinessException } from "../../common/errors/business-exception";
import { ERROR_CODES, type AdminMe } from "@platform/types";

interface RequestContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}


/**
 * Rate-limit tracker key for an email identity — hashed rather than
 * stored as plaintext in Redis key names, and normalized (trim +
 * lowercase) so "Admin@X.com" and " admin@x.com " share one counter.
 */
function identityTrackerKey(email: string): string {
  return hashToken(email.trim().toLowerCase());
}

/**
 * The raw login ticket is itself a bearer credential for the 2FA
 * stage — never used directly as a Redis key name (which could show
 * up in Redis introspection tools, slow-query logs, or monitoring).
 * Hashed the same way as the email identity key above.
 */
function ticketTrackerKey(ticketId: string): string {
  return hashToken(ticketId);
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly securitySettings: SecuritySettingsService,
    private readonly rateLimiter: DynamicRateLimiter,
    private readonly sessions: AdminSessionService,
    private readonly tickets: AdminLoginTicketService,
    @Inject(APP_ENV) private readonly env: Env
  ) {}

  /**
   * Stage 1: email + password. NEVER issues a full session — only a
   * short-lived ticket pointing at whichever 2FA stage comes next.
   */
  async login(email: string, password: string, ctx: RequestContext): Promise<{
    stage: "SETUP_REQUIRED" | "VERIFY_REQUIRED";
    ticket: string;
  }> {
    const limit = await this.securitySettings.getAdminLoginRateLimit();
    await this.rateLimiter.enforce("admin-login-ip", ctx.ipAddress ?? "unknown", limit);
    await this.rateLimiter.enforce("admin-login-identity", identityTrackerKey(email), limit);

    const admin = await this.prisma.adminUser.findUnique({ where: { email } });

    const passwordOk = admin
      ? await verifyPassword(admin.passwordHash, password)
      : await verifyPassword(
          "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          password
        );

    if (!admin || !passwordOk || admin.status !== AdminUserStatus.ACTIVE) {
      await this.audit.log({
        actorType: AuditActorType.ADMIN,
        actorId: admin?.id,
        action: "ADMIN_LOGIN_FAILED",
        entityType: "admin_user",
        entityId: admin?.id ?? "unknown",
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new BusinessException(401, ERROR_CODES.INVALID_CREDENTIALS, "Invalid email or password");
    }

    const stage: LoginTicketData["stage"] = admin.twoFactorSecretEncrypted
      ? "AWAITING_2FA_VERIFY"
      : "AWAITING_2FA_SETUP";

    const ticket = await this.tickets.create({ adminUserId: admin.id, stage });

    return { stage: stage === "AWAITING_2FA_VERIFY" ? "VERIFY_REQUIRED" : "SETUP_REQUIRED", ticket };
  }

  /** Stage 2a (first-time only): generates a pending secret + recovery codes, not yet persisted. */
  async begin2faSetup(ticketId: string): Promise<{
    otpauthUri: string;
    secret: string;
    recoveryCodes: string[];
  }> {
    const ticket = await this.requireTicket(ticketId, "AWAITING_2FA_SETUP");
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: ticket.adminUserId } });

    const enrollment = generateTotpEnrollment(admin.email, this.env.ADMIN_TOTP_ISSUER);
    const recovery = generateRecoveryCodes();
    const encrypted = encryptSecret(enrollment.secret, this.env.ADMIN_TOTP_ENCRYPTION_KEY);

    await this.tickets.update(ticketId, {
      adminUserId: ticket.adminUserId,
      stage: "AWAITING_2FA_SETUP",
      pendingSecretEncrypted: encrypted,
      pendingRecoveryCodeHashes: recovery.hashes,
    });

    return {
      otpauthUri: enrollment.otpauthUri,
      secret: enrollment.secret,
      recoveryCodes: recovery.plaintext,
    };
  }

  /** Stage 2b (first-time only): proves control of the authenticator app, persists 2FA, issues the full session. */
  async confirm2faSetup(
    ticketId: string,
    code: string,
    ctx: RequestContext
  ): Promise<{ sessionId: string; ttlSeconds: number }> {
    const limit = await this.securitySettings.getAdmin2faRateLimit();
    await this.rateLimiter.enforce("admin-2fa-ip", ctx.ipAddress ?? "unknown", limit);
    await this.rateLimiter.enforce("admin-2fa-ticket", ticketTrackerKey(ticketId), limit);

    const ticket = await this.requireTicket(ticketId, "AWAITING_2FA_SETUP");
    if (!ticket.pendingSecretEncrypted || !ticket.pendingRecoveryCodeHashes) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "2FA setup was not started");
    }

    const secret = decryptSecret(ticket.pendingSecretEncrypted, this.env.ADMIN_TOTP_ENCRYPTION_KEY);
    if (!verifyTotpCode(secret, code)) {
      await this.audit.log({
        actorType: AuditActorType.ADMIN,
        actorId: ticket.adminUserId,
        action: "ADMIN_2FA_VERIFY_FAILED",
        entityType: "admin_user",
        entityId: ticket.adminUserId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new BusinessException(401, ERROR_CODES.INVALID_CREDENTIALS, "Invalid verification code");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: ticket.adminUserId },
        data: {
          twoFactorSecretEncrypted: ticket.pendingSecretEncrypted,
          twoFactorEnabledAt: new Date(),
        },
      });
      for (const hash of ticket.pendingRecoveryCodeHashes ?? []) {
        await tx.adminRecoveryCode.create({
          data: { adminUserId: ticket.adminUserId, codeHash: hash },
        });
      }
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ticket.adminUserId,
      action: "ADMIN_2FA_ENABLED",
      entityType: "admin_user",
      entityId: ticket.adminUserId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.tickets.consume(ticketId);
    const { sessionId, ttlSeconds } = await this.issueSession(
      ticket.adminUserId,
      ctx,
      "ADMIN_LOGIN_SUCCESS"
    );
    return { sessionId, ttlSeconds };
  }

  /** Stage 2 (returning admin): verify TOTP code or a one-time recovery code. */
  async verify2fa(
    ticketId: string,
    ctx: RequestContext,
    input: { code?: string; recoveryCode?: string }
  ): Promise<{ sessionId: string; ttlSeconds: number }> {
    const limit = await this.securitySettings.getAdmin2faRateLimit();
    await this.rateLimiter.enforce("admin-2fa-ip", ctx.ipAddress ?? "unknown", limit);
    await this.rateLimiter.enforce("admin-2fa-ticket", ticketTrackerKey(ticketId), limit);

    const ticket = await this.requireTicket(ticketId, "AWAITING_2FA_VERIFY");
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: ticket.adminUserId } });

    let ok = false;
    let usedRecoveryCode = false;

    if (input.code && admin.twoFactorSecretEncrypted) {
      const secret = decryptSecret(admin.twoFactorSecretEncrypted, this.env.ADMIN_TOTP_ENCRYPTION_KEY);
      ok = verifyTotpCode(secret, input.code);
    } else if (input.recoveryCode) {
      ok = await this.consumeRecoveryCode(admin.id, input.recoveryCode);
      usedRecoveryCode = ok;
    }

    if (!ok) {
      await this.audit.log({
        actorType: AuditActorType.ADMIN,
        actorId: admin.id,
        action: "ADMIN_2FA_VERIFY_FAILED",
        entityType: "admin_user",
        entityId: admin.id,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new BusinessException(401, ERROR_CODES.INVALID_CREDENTIALS, "Invalid code");
    }

    await this.tickets.consume(ticketId);
    const { sessionId, ttlSeconds } = await this.issueSession(
      admin.id,
      ctx,
      usedRecoveryCode ? "ADMIN_RECOVERY_CODE_USED" : "ADMIN_2FA_VERIFY_SUCCESS"
    );
    return { sessionId, ttlSeconds };
  }

  /**
   * Who the caller is — the whole basis of the admin portal's guard.
   *
   * A CLOSED shape: an id, an email to greet them by, the status the
   * guard checks, and whether 2FA is enrolled. `twoFactorEnabled` is
   * derived from the timestamp; neither the timestamp, the encrypted
   * secret, the password hash nor any recovery-code hash is selected.
   *
   * Re-reads the ROW rather than trusting the session blob. A session
   * created before an administrator was disabled would otherwise keep
   * working until it expired.
   */
  async me(adminUserId: string): Promise<AdminMe> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { id: true, email: true, status: true, twoFactorEnabledAt: true },
    });
    if (!admin) {
      throw new BusinessException(401, ERROR_CODES.UNAUTHORIZED, "Admin account no longer exists");
    }
    if (admin.status !== AdminUserStatus.ACTIVE) {
      throw new BusinessException(401, ERROR_CODES.UNAUTHORIZED, "Admin account is not active");
    }

    return {
      id: admin.id,
      email: admin.email,
      status: admin.status as AdminMe["status"],
      twoFactorEnabled: admin.twoFactorEnabledAt !== null,
    };
  }

  /**
   * Changes the caller's OWN password.
   *
   * Requires the current password and a session that already completed
   * MFA — this route sits behind `AdminSessionAuthGuard`, and a session
   * only exists after `2fa/verify` or `2fa/setup/confirm`.
   *
   * Every OTHER session for this admin is revoked. A password change is
   * how someone responds to a suspected compromise, and leaving the
   * attacker's session alive would defeat the point. The caller's own
   * session survives, so they are not logged out of the tab they are
   * standing in.
   */
  async changeOwnPassword(
    adminUserId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext
  ): Promise<void> {
    const limit = await this.securitySettings.getAdminLoginRateLimit();
    await this.rateLimiter.enforce("admin-password-change", adminUserId, limit);

    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });

    if (!(await verifyPassword(admin.passwordHash, currentPassword))) {
      await this.audit.log({
        actorType: AuditActorType.ADMIN,
        actorId: adminUserId,
        action: "ADMIN_PASSWORD_CHANGE_FAILED",
        entityType: "admin_user",
        entityId: adminUserId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new BusinessException(
        401,
        ERROR_CODES.INVALID_CREDENTIALS,
        "Current password is incorrect"
      );
    }

    if (await verifyPassword(admin.passwordHash, newPassword)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "The new password must differ from the current one"
      );
    }

    const passwordHash = await hashPassword(newPassword);

    // The write and its audit record together, so a password that
    // changed without a trace is not a reachable state.
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: adminUserId }, data: { passwordHash } });
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: adminUserId,
          action: "ADMIN_PASSWORD_CHANGED",
          entityType: "admin_user",
          entityId: adminUserId,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    });

    await this.sessions.revokeAllForAdminExcept(adminUserId, currentSessionId);
  }

  /**
   * Replaces the caller's recovery codes.
   *
   * The old codes are deleted and new ones issued in ONE transaction, so
   * there is no window in which an admin has none. The plaintext is
   * returned exactly once and stored nowhere — only hashes are written —
   * which is why this response is the only place the codes ever exist
   * readable.
   *
   * Requires the current password: possession of a live session is not
   * enough to mint a fresh set of bearer credentials.
   */
  async regenerateOwnRecoveryCodes(
    adminUserId: string,
    currentPassword: string,
    ctx: RequestContext
  ): Promise<{ codes: string[]; count: number }> {
    const limit = await this.securitySettings.getAdmin2faRateLimit();
    await this.rateLimiter.enforce("admin-recovery-regenerate", adminUserId, limit);

    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    if (!(await verifyPassword(admin.passwordHash, currentPassword))) {
      throw new BusinessException(
        401,
        ERROR_CODES.INVALID_CREDENTIALS,
        "Current password is incorrect"
      );
    }
    if (!admin.twoFactorSecretEncrypted) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Recovery codes require an enrolled authenticator"
      );
    }

    const recovery = generateRecoveryCodes();

    await this.prisma.$transaction(async (tx) => {
      await tx.adminRecoveryCode.deleteMany({ where: { adminUserId } });
      for (const hash of recovery.hashes) {
        await tx.adminRecoveryCode.create({ data: { adminUserId, codeHash: hash } });
      }
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: adminUserId,
          action: "ADMIN_RECOVERY_CODES_REGENERATED",
          entityType: "admin_user",
          entityId: adminUserId,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    });

    return { codes: recovery.plaintext, count: recovery.plaintext.length };
  }

  async logout(sessionId: string, adminUserId: string, ctx: RequestContext): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminUserId,
      action: "ADMIN_LOGOUT",
      entityType: "admin_user",
      entityId: adminUserId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async consumeRecoveryCode(adminUserId: string, rawCode: string): Promise<boolean> {
    const codeHash = hashToken(rawCode.trim().toUpperCase());
    const row = await this.prisma.adminRecoveryCode.findUnique({ where: { codeHash } });
    if (!row || row.adminUserId !== adminUserId || row.consumedAt) return false;

    const consumed = await this.prisma.adminRecoveryCode.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return consumed.count === 1;
  }

  private async issueSession(
    adminUserId: string,
    ctx: RequestContext,
    auditAction: string
  ): Promise<{ sessionId: string; ttlSeconds: number }> {
    /**
     * The account is re-checked HERE, at the last moment before a session
     * exists.
     *
     * A login ticket is issued at stage 1 and consumed at stage 2, and
     * tickets carry no per-admin index — so an administrator disabled
     * between the two stages could otherwise complete 2FA and receive a
     * working session. Checking the row here closes that without needing
     * ticket revocation, and it holds for every path that issues a
     * session rather than for the ones someone remembered to guard.
     */
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { status: true },
    });
    if (!admin || admin.status !== AdminUserStatus.ACTIVE) {
      throw new BusinessException(401, ERROR_CODES.UNAUTHORIZED, "Admin account is not active");
    }

    const ttlSeconds = await this.securitySettings.getAdminSessionDurationSeconds();
    const sessionId = await this.sessions.create({ adminUserId }, ttlSeconds);
    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminUserId,
      action: auditAction,
      entityType: "admin_user",
      entityId: adminUserId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return { sessionId, ttlSeconds };
  }

  private async requireTicket(
    ticketId: string,
    expectedStage: LoginTicketData["stage"]
  ): Promise<LoginTicketData> {
    const ticket = await this.tickets.get(ticketId);
    if (!ticket || ticket.stage !== expectedStage) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or expired ticket");
    }
    return ticket;
  }
}
