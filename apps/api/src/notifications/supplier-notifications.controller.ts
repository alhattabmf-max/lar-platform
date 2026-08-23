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
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

/**
 * The supplier's notifications — Option A's four routes.
 *
 * 8D's producers already write supplier-targeted notifications:
 * `ORDER_CREATED`, `DISPUTE_OPENED`, `REPLACEMENT_REQUIRED` and
 * `SETTLEMENT_EXECUTED` all carry `targetCompany: "SUPPLIER"`. Until these
 * routes existed they were written and unreadable — a settlement notification
 * with nowhere to go.
 *
 * `NotificationsService` is reused UNCHANGED. It was written role-neutral:
 * every method takes `{userId, companyId}` and filters on both, so the
 * isolation is a property of the service rather than of who calls it. Adding a
 * role-aware branch would have made the boundary something each caller has to
 * get right; this way there is nothing to get wrong.
 *
 * Read state stays per USER. A colleague clearing their feed does not clear
 * anyone else's, and that follows from the same filter — it is not a separate
 * rule this controller has to honour.
 *
 * `CsrfGuard` is at the controller level because two of the four are POSTs.
 * The provider exempts safe methods, so the two GETs are unaffected.
 *
 * Nothing here exposes an email address, a delivery status or the outbox.
 */
@Controller("supplier/notifications")
@UseGuards(SessionAuthGuard, RequireSupplierGuard, CsrfGuard)
export class SupplierNotificationsController {
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
   * Idempotent: repeating it moves nothing and returns the ORIGINAL `readAt`,
   * so a double-click cannot make a notification look newly read. 200 rather
   * than 201 — nothing is created.
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
