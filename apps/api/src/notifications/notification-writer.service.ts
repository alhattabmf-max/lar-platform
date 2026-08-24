import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  NOTIFICATION_TYPE_ENTITY_TYPES,
  emitsEmail,
  isAllowedNotificationEntityType,
  type NotificationEntityType,
  type NotificationParams,
  type NotificationType,
} from "@platform/types";
import {
  DEFAULT_EMAIL_LOCALE,
  EMAIL_NOTIFICATION_V1,
  buildCreationIdempotencyKey,
  isEmailTemplateId,
} from "@platform/email";
import { assertValidNotificationParams } from "./notification-params";

/**
 * The single write path for notifications.
 *
 * Called from INSIDE a business event's transaction — the same pattern
 * `AuditLog` and `OutboxEvent` already follow — so the notification,
 * its recipients and its email intents either all exist or none do,
 * together with the change they describe. A separate round trip after
 * the commit would leave a window where a payment succeeded and nobody
 * was told.
 *
 * DEDUPLICATION IS THE DATABASE'S JOB. Every insert here is
 * `ON CONFLICT DO NOTHING`, never a read-then-write. Two workers
 * reprocessing the same event race, and the loser gets zero rows back
 * rather than a second notification. Just as importantly, `DO NOTHING`
 * means a collision is NOT an error: a unique violation raised inside
 * the caller's transaction would abort the entire business operation,
 * which is precisely the wrong outcome for something as peripheral as a
 * duplicate notification.
 *
 * The email contract is IMPORTED from `@platform/email`, never
 * re-derived here. If 8D0's payload shape or key format changes, this
 * file stops compiling instead of quietly producing rows the relay will
 * dead-letter as PAYLOAD_INVALID.
 */

export interface EmitNotificationInput {
  companyId: string;
  type: NotificationType;
  entityType: NotificationEntityType;
  entityId: string;
  params: NotificationParams;
  /**
   * Distinguishes several notifications of the same type about the same
   * entity — a state machine passing through the same step twice, for
   * instance. Part of the dedupe key, so omitting it means "there can
   * be only one of these, ever".
   */
  discriminator?: string;
}

export interface EmitNotificationResult {
  /** Null when an identical notification already existed. */
  notificationId: string | null;
  created: boolean;
  recipientsCreated: number;
  emailIntentsCreated: number;
}

/** `${type}:${entityType}:${entityId}:${discriminator}` */
export function buildDedupeKey(input: {
  type: NotificationType;
  entityType: string;
  entityId: string;
  discriminator?: string;
}): string {
  return `${input.type}:${input.entityType}:${input.entityId}:${input.discriminator ?? ""}`;
}

@Injectable()
export class NotificationWriterService {
  private readonly logger = new Logger(NotificationWriterService.name);

  /**
   * Creates one notification, a recipient row for every active user of
   * the company, and an email intent per recipient for the 13 types
   * that emit one.
   *
   * `tx` is REQUIRED, not optional. A notification written outside the
   * business transaction is a notification that can exist without the
   * event it describes, and making the parameter optional would make
   * that the easy mistake to reach for.
   */
  async emit(
    tx: Prisma.TransactionClient,
    input: EmitNotificationInput
  ): Promise<EmitNotificationResult> {
    // Throws before anything is written, so a malformed producer fails
    // its own business transaction rather than persisting bad params.
    const params = assertValidNotificationParams(input.type, input.params);

    // `entityType` must describe what `entityId` ACTUALLY is. Without
    // this a notification could claim to point at an order while
    // carrying a checkout session id, and the UI would follow it to a
    // 404 — or to an unrelated record that happened to share the id
    // space.
    if (!isAllowedNotificationEntityType(input.type, input.entityType)) {
      throw new Error(
        `Notification ${input.type} may not point at entityType "${input.entityType}" — ` +
          `permitted: ${NOTIFICATION_TYPE_ENTITY_TYPES[input.type].join(", ")}`
      );
    }

    const dedupeKey = buildDedupeKey(input);

    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO notifications (company_id, type, entity_type, entity_id, params, dedupe_key)
      VALUES (
        ${input.companyId}::uuid,
        ${input.type}::"NotificationType",
        ${input.entityType},
        ${input.entityId}::uuid,
        ${JSON.stringify(params)}::jsonb,
        ${dedupeKey}
      )
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    `;

    if (inserted.length === 0) {
      // The event was already processed. Not an error, and deliberately
      // not a partial re-run: the recipients and intents belonging to
      // the original notification are already there, and re-deriving
      // them here would risk creating rows for a user list that has
      // since changed.
      this.logger.debug(`Notification already exists for dedupe key [${input.type}] — no-op`);
      return { notificationId: null, created: false, recipientsCreated: 0, emailIntentsCreated: 0 };
    }

    const notificationId = inserted[0].id;

    // Recipient expansion: every ACTIVE user of the company at creation
    // time. A suspended or disabled account is skipped — there is
    // nobody to read it, and the relay would refuse to email them
    // anyway.
    const recipients = await tx.user.findMany({
      where: { companyId: input.companyId, status: "ACTIVE" },
      select: { id: true },
    });

    if (recipients.length === 0) {
      this.logger.warn(
        `Notification ${input.type} created for a company with no active users — no recipients`
      );
      return { notificationId, created: true, recipientsCreated: 0, emailIntentsCreated: 0 };
    }

    const recipientsCreated = await this.insertRecipients(
      tx,
      notificationId,
      recipients.map((r) => r.id)
    );

    const emailIntentsCreated = emitsEmail(input.type)
      ? await this.insertEmailIntents(tx, {
          notificationId,
          type: input.type,
          params,
          recipientUserIds: recipients.map((r) => r.id),
        })
      : 0;

    return { notificationId, created: true, recipientsCreated, emailIntentsCreated };
  }

  /**
   * One row per recipient, `ON CONFLICT DO NOTHING` on the
   * (notification, user) unique index — so a retry of this step cannot
   * give anyone two copies.
   */
  private async insertRecipients(
    tx: Prisma.TransactionClient,
    notificationId: string,
    userIds: string[]
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO notification_recipients (notification_id, user_id)
      SELECT ${notificationId}::uuid, unnest(${userIds}::uuid[])
      ON CONFLICT (notification_id, user_id) DO NOTHING
      RETURNING id
    `;
    return rows.length;
  }

  /**
   * One `EMAIL_NOTIFICATION_V1` outbox row per recipient.
   *
   * The idempotency key is per (notification, RECIPIENT), not per
   * notification: one notification legitimately reaches several
   * colleagues, and a key that ignored the recipient would let the
   * partial unique index suppress everyone after the first.
   *
   * `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL`
   * targets the existing PARTIAL unique index from migration
   * 20260816000500 — a bare `ON CONFLICT (idempotency_key)` would not
   * match a partial index and would raise instead of no-op'ing.
   *
   * The payload carries NO email address. The relay resolves
   * `users.email` at send time, so this row holds no PII and the right
   * to erasure works without a special case.
   */
  private async insertEmailIntents(
    tx: Prisma.TransactionClient,
    input: {
      notificationId: string;
      type: NotificationType;
      params: NotificationParams;
      recipientUserIds: string[];
    }
  ): Promise<number> {
    // The 13 email-emitting notification types are named identically to
    // the 13 template ids, which is what makes this a check rather than
    // a translation table that could drift. A failure here is a
    // programming error, not data.
    if (!isEmailTemplateId(input.type)) {
      throw new Error(
        `Notification type ${input.type} emits email but has no template in @platform/email`
      );
    }

    const payloads = input.recipientUserIds.map((recipientUserId) => ({
      key: buildCreationIdempotencyKey(input.notificationId, recipientUserId),
      payload: JSON.stringify({
        v: 1,
        notificationId: input.notificationId,
        recipientUserId,
        template: input.type,
        params: input.params,
      }),
    }));

    // `updated_at` is NOT NULL with no database default — Prisma fills it
    // from `@updatedAt` in the CLIENT, which a raw INSERT bypasses. Every
    // other writer uses tx.outboxEvent.create(); this is the only raw one,
    // so it has to supply the column itself or the insert fails 23502.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO outbox_events (event_type, payload, idempotency_key, updated_at)
      SELECT ${EMAIL_NOTIFICATION_V1}, payload::jsonb, key, now()
      FROM unnest(${payloads.map((p) => p.payload)}::text[], ${payloads.map((p) => p.key)}::text[])
        AS t(payload, key)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING id
    `;
    return rows.length;
  }
}

/**
 * The locale every email intent is rendered in.
 *
 * Re-exported so a producer never hard-codes it: `User` has no locale
 * preference field, so there is nothing to read and Arabic is the
 * platform default. Adding `User.preferredLocale` is deferred and is a
 * prerequisite for a real provider.
 */
export const NOTIFICATION_EMAIL_LOCALE = DEFAULT_EMAIL_LOCALE;
