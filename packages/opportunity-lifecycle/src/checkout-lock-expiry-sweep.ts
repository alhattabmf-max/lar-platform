import { AuditActorType, type Prisma, type PrismaClient } from "@prisma/client";

const BATCH_SIZE = 200;
const MAX_BATCHES_PER_RUN = 50;

export interface CheckoutLockExpirySweepResult {
  locksExpired: number;
}

/**
 * Deliberately an entirely SEPARATE sweep from
 * runOpportunityLifecycleSweep (sweep.ts) — a different domain
 * concern (Checkout locks, Phase 7B) must never share that function's
 * structural contract of touching ONLY
 * opportunities/audit_logs/outbox_events. This file's own contract is
 * symmetric but distinct: it touches ONLY
 * checkout_sessions/audit_logs/outbox_events, and nothing else,
 * enforced by its own dedicated structural test.
 *
 * Expires checkout_sessions whose lock has passed lock_expires_at but
 * is still LOCKED — the batched, worker-driven counterpart to the
 * request-time Lazy Cleanup performed inline by
 * CheckoutSessionService (create()/getById()). Both exist
 * deliberately: Lazy Cleanup handles the common case (a trader
 * reads/re-locks promptly), this sweep guarantees eventual
 * correctness even if nobody ever reads that session again.
 * FOR UPDATE SKIP LOCKED means this sweep, CheckoutSessionService's
 * Lazy Cleanup, and another instance of this same sweep can all race
 * on the same expired row safely — whichever claims it first wins,
 * everyone else's claim matches zero rows, so exactly one transition
 * and one Audit/Outbox pair is ever produced per row.
 */
export async function runCheckoutLockExpirySweep(prisma: PrismaClient): Promise<CheckoutLockExpirySweepResult> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const processed = await prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<{ id: string; trader_company_id: string }[]>`
        WITH batch AS (
          SELECT id FROM checkout_sessions
          WHERE status = 'LOCKED' AND lock_released_at IS NULL AND lock_expires_at <= now()
          ORDER BY lock_expires_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE checkout_sessions cs SET status = 'EXPIRED', lock_released_at = now(), release_reason = 'EXPIRED'
        FROM batch WHERE cs.id = batch.id
        RETURNING cs.id, cs.trader_company_id
      `;

      for (const row of expired) {
        const requestId = `system-checkout-sweep-${row.id}-${Date.now()}`;
        await tx.auditLog.create({
          data: {
            actorType: AuditActorType.SYSTEM,
            companyId: row.trader_company_id,
            action: "CHECKOUT_LOCK_EXPIRED",
            entityType: "checkout_session",
            entityId: row.id,
            requestId,
          },
        });
        await tx.outboxEvent.create({
          data: {
            eventType: "CHECKOUT_LOCK_EXPIRED",
            payload: { checkoutSessionId: row.id } as Prisma.InputJsonValue,
          },
        });
      }
      return expired.length;
    });

    total += processed;
    if (processed < BATCH_SIZE) break;
  }
  return { locksExpired: total };
}
