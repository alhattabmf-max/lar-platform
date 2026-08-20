import { Inject, Injectable } from "@nestjs/common";
import { AuditActorType, AdminUserStatus } from "@prisma/client";
import type { Env } from "@platform/config";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { APP_ENV } from "../../config/app-config.module";
import { SecuritySettingsService } from "../../settings/security-settings.service";
import { DynamicRateLimiter } from "../../common/security/dynamic-rate-limiter";
import { verifyPassword } from "../../common/security/argon2.util";
import { hashToken } from "../../common/security/token.util";
import { encryptSecret, decryptSecret } from "../../common/security/crypto.util";
import { generateTotpEnrollment, verifyTotpCode } from "../../common/security/totp.util";
import { generateRecoveryCodes } from "../../common/security/recovery-codes.util";
import { AdminSessionService } from "./admin-session.service";
import { AdminLoginTicketService, type LoginTicketData } from "./admin-login-ticket.service";
import { BusinessException } from "../../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

interface RequestContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const TOTP_ISSUER = "PROJECT_NAME Admin";

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

    const enrollment = generateTotpEnrollment(admin.email, TOTP_ISSUER);
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
