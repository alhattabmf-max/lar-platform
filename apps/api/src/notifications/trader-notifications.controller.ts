import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import type {
  NotificationItem,
  NotificationReadAllResult,
  NotificationReadResult,
  NotificationUnreadCount,
  Paginated,
} from "@platform/types";
import { NotificationsService } from "./notifications.service";
import { ListNotificationsQueryDto } from "./dto/list-notifications-query.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

/**
 * A trader's own notifications.
 *
 * `CsrfGuard` is applied at class level, matching the project's other
 * session-scoped controllers. It is not a mistake on the GETs: the
 * underlying Origin/Referer check exempts safe methods, so the reads
 * pass through untouched and the two POSTs are protected without a
 * per-route decorator anyone could forget.
 *
 * Every route is scoped to the session's user AND company inside the
 * query itself. A notification belonging to someone else answers
 * **404, not 403** — a 403 would confirm the id exists and turn this
 * into an enumeration oracle.
 *
 * Nothing here exposes an email address, a delivery status, or any
 * notion of the outbox. Whether a given notification also produced an
 * email is invisible to this API on purpose: the UI shows in-app
 * notifications and must never read as a delivery dashboard, least of
 * all while the provider delivers nothing.
 */
@Controller("trader/notifications")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class TraderNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query() query: ListNotificationsQueryDto,
    @CurrentSession() session: SessionData
  ): Promise<Paginated<NotificationItem>> {
    return this.notifications.list(
      { userId: session.userId, companyId: session.companyId },
      query
    );
  }

  /** Drives the unread badge without fetching a page of items. */
  @Get("unread-count")
  unreadCount(@CurrentSession() session: SessionData): Promise<NotificationUnreadCount> {
    return this.notifications.unreadCount({
      userId: session.userId,
      companyId: session.companyId,
    });
  }

  /**
   * Idempotent: repeating it moves nothing and returns the ORIGINAL
   * `readAt`, so a double-click cannot make a notification look newly
   * read. 200 rather than 201 — nothing is created.
   */
  @Post(":id/read")
  @HttpCode(200)
  markRead(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<NotificationReadResult> {
    return this.notifications.markRead(
      { userId: session.userId, companyId: session.companyId },
      id
    );
  }

  /** Returns how many rows this call actually moved, not the total already read. */
  @Post("read-all")
  @HttpCode(200)
  markAllRead(@CurrentSession() session: SessionData): Promise<NotificationReadAllResult> {
    return this.notifications.markAllRead({
      userId: session.userId,
      companyId: session.companyId,
    });
  }
}
