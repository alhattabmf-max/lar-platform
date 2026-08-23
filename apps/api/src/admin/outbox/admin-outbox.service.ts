import { Inject, Injectable } from "@nestjs/common";
import { OutboxStatus } from "@prisma/client";
import type { Env } from "@platform/config";
import { isSimulatedProviderMode } from "@platform/config";
import { RELAY_SUPPORTED_EVENT_TYPES } from "@platform/email";
import type { OutboxStats } from "@platform/types";
import { PrismaService } from "../../database/prisma.service";
import { APP_ENV } from "../../config/app-config.module";

/**
 * Relay health, as counts and nothing else.
 *
 * WHAT IS DELIBERATELY ABSENT, and why each one matters:
 *
 *   payload   — an outbox payload carries the email address the message
 *               was addressed to. A stats screen has no business holding
 *               one, and "we only show it to admins" is not a boundary.
 *   lastError — a free-text error column invites an exception message,
 *               and provider exception text routinely echoes the
 *               recipient address. The schema itself notes that nothing
 *               writes it; this makes sure nothing reads it either.
 *   lockedBy  — a worker id is observability, never a correctness guard,
 *               and it is meaningless outside the relay.
 *   idempotencyKey — derived from the event and its target; it is a
 *               correlation value for the provider, not for a dashboard.
 *
 * `providerMode` is REQUIRED and every consumer must render it. While it
 * is a simulated mode, nothing is delivered anywhere, and a dashboard of
 * green counts that does not say so is a lie told in numbers.
 *
 * `PUBLISHED` MEANS THE PROVIDER ACCEPTED THE REQUEST. It does not mean
 * anything arrived. The relay gives at-least-once delivery with a stable
 * provider idempotency key — not exactly-once — and no count here can
 * report a delivery.
 *
 * There is no retry and no delete. Both are deferred beyond Phase 8: a
 * manual retry button on a table with a lease and a backoff is a way to
 * race the relay, and a delete is a way to lose an intent that was
 * written inside a business transaction.
 */
@Injectable()
export class AdminOutboxService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: Env
  ) {}

  async stats(): Promise<OutboxStats> {
    const now = new Date();

    const [grouped, deferred, leased, lastPublished, oldestPending, total] = await Promise.all([
      this.prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } }),
      // Deferred for backoff: a future attempt time means not eligible
      // now, which is the difference between "stuck" and "waiting".
      this.prisma.outboxEvent.count({
        where: { status: OutboxStatus.PENDING, nextAttemptAt: { gt: now } },
      }),
      // Currently leased by a worker — an unexpired lease, not merely a
      // non-null one, since an expired lease is reclaimable.
      this.prisma.outboxEvent.count({ where: { lockedUntil: { gt: now } } }),
      this.prisma.outboxEvent.findFirst({
        where: { publishedAt: { not: null } },
        select: { publishedAt: true },
        orderBy: { publishedAt: "desc" },
      }),
      /**
       * The real backlog signal: how long the oldest intent the relay
       * WILL ACTUALLY PICK UP has been waiting.
       *
       * Restricted to `RELAY_SUPPORTED_EVENT_TYPES` — the same constant
       * the worker's claim query filters on. The table holds at least
       * thirty other event-type literals from earlier phases that the
       * relay never reads, never locks and never updates. Counting one
       * of those as backlog would report a permanent, growing delay that
       * no amount of relay health could ever clear, and the first
       * response to it would be to look for a bug that does not exist.
       *
       * `nextAttemptAt` is deliberately NOT used here. A row deferred
       * for backoff is waiting on purpose; folding that into "oldest
       * pending" would make a healthy retry look like a stall.
       */
      this.prisma.outboxEvent.findFirst({
        where: {
          status: OutboxStatus.PENDING,
          eventType: { in: [...RELAY_SUPPORTED_EVENT_TYPES] },
        },
        select: { createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.outboxEvent.count(),
    ]);

    const counts: OutboxStats["counts"] = {
      PENDING: 0,
      PROCESSING: 0,
      PUBLISHED: 0,
      FAILED: 0,
    };
    for (const row of grouped) {
      counts[row.status as keyof OutboxStats["counts"]] = row._count._all;
    }

    return {
      // Read from the environment the process actually booted with, not
      // from a constant. If a real provider is ever configured, this
      // reports it without an edit here.
      providerMode: this.env.EMAIL_PROVIDER_MODE,
      counts,
      deferred,
      leased,
      lastPublishedAt: lastPublished?.publishedAt?.toISOString() ?? null,
      oldestPendingAt: oldestPending?.createdAt.toISOString() ?? null,
      total,
    };
  }

  /** True when the configured provider delivers nothing. */
  isSimulated(): boolean {
    return isSimulatedProviderMode(this.env.EMAIL_PROVIDER_MODE);
  }
}
