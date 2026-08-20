import { AuditActorType, type Prisma, type PrismaClient } from "@prisma/client";

const BATCH_SIZE = 200;
const MAX_BATCHES_PER_RUN = 50;

export interface PaymentPendingExpirySweepResult {
  attemptsExpired: number;
}

/**
 * A THIRD, entirely separate sweep: PAYMENT_PENDING reserves quantity
 * until paymentDeadlineAt — a separate clock from lockExpiresAt — and
 * only this sweep ends it, never the LOCKED sweep. Ends both the
 * CheckoutSession and its active PaymentAttempt atomically. If a
 * genuinely successful webhook arrives later for an attempt this
 * sweep already expired, providerCapturedAt — never arrival order —
 * decides whether an order is still created.
 */
export async function runPaymentPendingExpirySweep(prisma: PrismaClient): Promise<PaymentPendingExpirySweepResult> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const processed = await prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<{ id: string; trader_company_id: string }[]>`
        WITH batch AS (
          SELECT id FROM checkout_sessions
          WHERE status = 'PAYMENT_PENDING' AND lock_released_at IS NULL AND payment_deadline_at <= now()
          ORDER BY payment_deadline_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE checkout_sessions cs SET status = 'EXPIRED', lock_released_at = now(), release_reason = 'EXPIRED'
        FROM batch WHERE cs.id = batch.id
        RETURNING cs.id, cs.trader_company_id
      `;

      for (const row of expired) {
        await tx.$executeRaw`
          UPDATE payment_attempts SET status = 'EXPIRED', updated_at = now()
          WHERE checkout_session_id = ${row.id}::uuid AND status IN ('CREATED', 'PENDING')
        `;

        const requestId = `system-payment-pending-sweep-${row.id}-${Date.now()}`;
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
          data: { eventType: "CHECKOUT_LOCK_EXPIRED", payload: { checkoutSessionId: row.id } as Prisma.InputJsonValue },
        });
      }
      return expired.length;
    });

    total += processed;
    if (processed < BATCH_SIZE) break;
  }
  return { attemptsExpired: total };
}
