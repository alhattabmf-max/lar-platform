import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  MAX_NOTIFICATION_PAGE_SIZE,
  type NotificationEntityType,
  type NotificationItem,
  type NotificationParams,
  type NotificationReadAllResult,
  type NotificationReadResult,
  type NotificationType,
  type NotificationUnreadCount,
  type Paginated,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";

/**
 * Reads and read-state mutations for one signed-in user.
 *
 * ISOLATION IS IN THE QUERY, never applied after fetching. Every
 * statement is constrained by BOTH `recipient.userId = session.userId`
 * AND `notification.companyId = session.companyId`. The user predicate
 * alone would already be sufficient in practice, but the company
 * predicate makes the boundary explicit and survives a future change
 * that lets a person belong to more than one company.
 *
 * A notification that is not this user's own is a **404, never a 403**.
 * A 403 confirms the id exists, which turns the endpoint into an
 * oracle for enumerating other people's notification ids.
 */

interface RecipientRow {
  readAt: Date | null;
  notification: {
    id: string;
    type: NotificationType;
    entityType: string;
    entityId: string;
    params: Prisma.JsonValue;
    createdAt: Date;
  };
}

const RECIPIENT_SELECT = {
  readAt: true,
  notification: {
    select: {
      id: true,
      type: true,
      entityType: true,
      entityId: true,
      params: true,
      createdAt: true,
    },
  },
} satisfies Prisma.NotificationRecipientSelect;

export interface NotificationScope {
  userId: string;
  companyId: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    scope: NotificationScope,
    query: { page?: number; pageSize?: number }
  ): Promise<Paginated<NotificationItem>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      MAX_NOTIFICATION_PAGE_SIZE,
      Math.max(1, query.pageSize ?? DEFAULT_NOTIFICATION_PAGE_SIZE)
    );

    const where = this.scopeWhere(scope);

    const [rows, total] = await Promise.all([
      this.prisma.notificationRecipient.findMany({
        where,
        select: RECIPIENT_SELECT,
        // A TOTAL order. `createdAt` alone is not unique, and a tie
        // spanning a page boundary under LIMIT/OFFSET can serve one row
        // twice and never serve another — the same reasoning that put
        // `id` at the end of every opportunity sort in 8C.
        orderBy: [{ notification: { createdAt: "desc" } }, { notification: { id: "asc" } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificationRecipient.count({ where }),
    ]);

    return { items: rows.map((row) => this.toItem(row)), page, pageSize, total };
  }

  /**
   * Drives the unread badge.
   *
   * A dedicated count rather than "fetch a page and look": the badge is
   * read on nearly every page load, and it is served by the
   * `(user_id, read_at)` index without touching the notifications
   * table at all.
   */
  async unreadCount(scope: NotificationScope): Promise<NotificationUnreadCount> {
    const unread = await this.prisma.notificationRecipient.count({
      where: { ...this.scopeWhere(scope), readAt: null },
    });
    return { unread };
  }

  /**
   * Marks one notification read for THIS user.
   *
   * Idempotent, and stable: the `read_at IS NULL` predicate means a
   * repeat call moves nothing and the original timestamp survives, so a
   * double-click cannot make a notification look newly read.
   *
   * `now()` comes from the database rather than the application clock,
   * consistent with every other timestamp this system writes.
   */
  async markRead(scope: NotificationScope, notificationId: string): Promise<NotificationReadResult> {
    const changed = await this.prisma.$executeRaw`
      UPDATE notification_recipients nr
      SET read_at = now()
      FROM notifications n
      WHERE nr.notification_id = n.id
        AND nr.notification_id = ${notificationId}::uuid
        AND nr.user_id = ${scope.userId}::uuid
        AND n.company_id = ${scope.companyId}::uuid
        AND nr.read_at IS NULL
    `;

    // Zero rows is ambiguous — already read, or not this user's. The
    // follow-up read resolves it, and only runs in that case.
    const current = await this.prisma.notificationRecipient.findFirst({
      where: { ...this.scopeWhere(scope), notificationId },
      select: { readAt: true },
    });

    if (!current) throw new NotFoundException("Notification not found");

    return {
      id: notificationId,
      // Non-null by construction: either this call set it, or a
      // previous one did.
      readAt: (current.readAt ?? new Date()).toISOString(),
      changed: changed > 0,
    };
  }

  /** Returns how many rows this call actually moved — not the total already read. */
  async markAllRead(scope: NotificationScope): Promise<NotificationReadAllResult> {
    const changed = await this.prisma.$executeRaw`
      UPDATE notification_recipients nr
      SET read_at = now()
      FROM notifications n
      WHERE nr.notification_id = n.id
        AND nr.user_id = ${scope.userId}::uuid
        AND n.company_id = ${scope.companyId}::uuid
        AND nr.read_at IS NULL
    `;
    return { changed };
  }

  private scopeWhere(scope: NotificationScope): Prisma.NotificationRecipientWhereInput {
    return { userId: scope.userId, notification: { companyId: scope.companyId } };
  }

  /**
   * Projects onto the wire contract.
   *
   * Explicit field-by-field, never a spread: a spread would forward
   * whatever a future column adds, which is how an internal field
   * reaches a client without anyone deciding it should.
   */
  private toItem(row: RecipientRow): NotificationItem {
    return {
      id: row.notification.id,
      type: row.notification.type,
      entityType: row.notification.entityType as NotificationEntityType,
      entityId: row.notification.entityId,
      params: (row.notification.params ?? {}) as NotificationParams,
      createdAt: row.notification.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    };
  }
}
