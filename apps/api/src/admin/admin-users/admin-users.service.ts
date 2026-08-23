import { Injectable, NotFoundException } from "@nestjs/common";
import { AdminUserStatus, AuditActorType, Prisma } from "@prisma/client";
import { ERROR_CODES, type AdminUserItem, type Paginated } from "@platform/types";
import { PrismaService } from "../../database/prisma.service";
import { BusinessException } from "../../common/errors/business-exception";
import { AdminSessionService } from "../admin-auth/admin-session.service";

/**
 * Administrator lifecycle.
 *
 * THERE IS NO CREATE HERE, deliberately. A new administrator is made by
 * the operational CLI (`dist/cli/bootstrap-admin.js`) and by nothing
 * else. An HTTP create — even one behind the admin guard — turns a
 * compromised admin session into the ability to mint more admins, which
 * is the one escalation this design exists to prevent.
 *
 * Two invariants protect against locking everyone out:
 *
 *   1. An administrator cannot disable THEMSELVES. Nobody should remove
 *      their own access by misclick, and a self-disable is
 *      indistinguishable from an attacker doing it for them.
 *   2. The LAST ACTIVE administrator cannot be disabled. A platform with
 *      no way in is recoverable only by database surgery.
 *
 * Both are checked inside the same transaction as the write, so two
 * concurrent disables cannot both pass a check made beforehand.
 */

interface AdminActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Columns for the list.
 *
 * `passwordHash`, `twoFactorSecretEncrypted` and every recovery-code
 * hash are NOT selected. Not selecting is stronger than not mapping: a
 * later refactor that spreads a row cannot leak a column the query never
 * asked for.
 */
const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  status: true,
  twoFactorEnabledAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { recoveryCodes: { where: { consumedAt: null } } } },
} satisfies Prisma.AdminUserSelect;

type AdminUserRow = Prisma.AdminUserGetPayload<{ select: typeof ADMIN_USER_SELECT }>;

function toItem(row: AdminUserRow): AdminUserItem {
  return {
    id: row.id,
    email: row.email,
    status: row.status as AdminUserItem["status"],
    // A boolean derived from the timestamp. The timestamp itself says
    // when someone enrolled, which nothing on this screen needs.
    twoFactorEnabled: row.twoFactorEnabledAt !== null,
    // A COUNT of unconsumed codes — never the codes, never their hashes.
    // "One code left" is the moment to regenerate, and a count is the
    // only safe way to say it.
    recoveryCodesRemaining: row._count.recoveryCodes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AdminSessionService
  ) {}

  async list(query: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  }): Promise<Paginated<AdminUserItem>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.AdminUserWhereInput = {
      ...(query.search
        ? { email: { contains: query.search.trim(), mode: "insensitive" as const } }
        : {}),
      ...(query.status ? { status: query.status as AdminUserStatus } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.adminUser.findMany({
        where,
        select: ADMIN_USER_SELECT,
        // Terminating in the primary key: two accounts created in the
        // same millisecond must not swap places between requests.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.adminUser.count({ where }),
    ]);

    return { items: rows.map(toItem), page, pageSize, total };
  }

  /**
   * Disables another administrator.
   *
   * Their sessions are revoked in the same operation — leaving a
   * disabled admin with a live session would make the action cosmetic
   * until the session expired.
   */
  async disable(id: string, reason: string, ctx: AdminActorContext): Promise<void> {
    if (id === ctx.actorId) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "You cannot disable your own administrator account"
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.adminUser.findUnique({ where: { id }, select: { status: true } });
      if (!target) throw new NotFoundException("Administrator not found");

      if (target.status !== AdminUserStatus.ACTIVE) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "This administrator is already disabled"
        );
      }

      // Counted INSIDE the transaction. Two concurrent disables that
      // each read "2 active" beforehand would otherwise both proceed and
      // leave zero.
      const activeCount = await tx.adminUser.count({
        where: { status: AdminUserStatus.ACTIVE },
      });
      if (activeCount <= 1) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "The last active administrator cannot be disabled"
        );
      }

      await tx.adminUser.update({
        where: { id },
        data: { status: AdminUserStatus.DISABLED },
      });

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "ADMIN_USER_DISABLED",
          entityType: "admin_user",
          entityId: id,
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    });

    await this.sessions.revokeAllForAdmin(id);
  }

  async enable(id: string, reason: string, ctx: AdminActorContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.adminUser.findUnique({ where: { id }, select: { status: true } });
      if (!target) throw new NotFoundException("Administrator not found");

      if (target.status === AdminUserStatus.ACTIVE) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "This administrator is already active"
        );
      }

      await tx.adminUser.update({ where: { id }, data: { status: AdminUserStatus.ACTIVE } });

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "ADMIN_USER_ENABLED",
          entityType: "admin_user",
          entityId: id,
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    });
  }

  /**
   * Clears another administrator's second factor.
   *
   * The recovery path for a lost authenticator, and the one action here
   * that briefly WEAKENS an account — so it deletes the old secret AND
   * every recovery code together, revokes their sessions, and leaves the
   * account able to sign in with a password only long enough to enrol
   * again: the next login returns `SETUP_REQUIRED` and issues no session
   * until a new authenticator is proven.
   *
   * Deleting the recovery codes matters as much as the secret. Codes
   * minted against the old enrolment would otherwise stay valid and
   * become a permanent bypass of the new one.
   */
  async resetTwoFactor(id: string, reason: string, ctx: AdminActorContext): Promise<void> {
    if (id === ctx.actorId) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Use your own account's recovery-code and password controls instead of resetting yourself"
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.adminUser.findUnique({
        where: { id },
        select: { twoFactorEnabledAt: true },
      });
      if (!target) throw new NotFoundException("Administrator not found");

      await tx.adminUser.update({
        where: { id },
        data: { twoFactorSecretEncrypted: null, twoFactorEnabledAt: null },
      });
      await tx.adminRecoveryCode.deleteMany({ where: { adminUserId: id } });

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "ADMIN_USER_2FA_RESET",
          entityType: "admin_user",
          entityId: id,
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    });

    await this.sessions.revokeAllForAdmin(id);
  }
}
