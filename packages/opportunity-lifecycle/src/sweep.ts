import { AuditActorType, type Prisma, type PrismaClient } from "@prisma/client";
import { finalizeOneScheduledOpportunity } from "./finalize-scheduled";

const BATCH_SIZE = 200;
const MAX_BATCHES_PER_RUN = 50;

/**
 * BUSINESS MEANING (final, confirmed model — see the opportunities
 * business-model correction that preceded this file's last update):
 *
 * targetQuantity is a SUPPLY CAP the supplier is willing to sell, not
 * a collective funding goal that must be reached before any order can
 * proceed. Every individually-paid order is created and sent to the
 * supplier for fulfillment IMMEDIATELY on payment success — nothing
 * ever waits for the opportunity to reach 100%, and there is no
 * concept of the opportunity "failing" for not reaching it.
 *
 * - ACTIVE -> FUNDED: the supply cap has been fully sold
 *   (funded_quantity >= target_quantity). Commercially this means
 *   "sold out" — it stops NEW sales only. It never touches
 *   already-paid orders, never reverses funded_quantity, and is not
 *   a success/completion event for anything beyond "no more units to
 *   sell".
 * - ACTIVE/PAUSED -> EXPIRED: the sales WINDOW has closed. This stops
 *   new sales only — it is not a failure state, does not cancel any
 *   already-paid order, does not touch funded_quantity, and does not
 *   trigger any refund.
 *
 * OUTBOX EVENT CONTRACT (binding on every future consumer):
 * OPPORTUNITY_FUNDED / OPPORTUNITY_EXPIRED / OPPORTUNITY_PAUSED /
 * OPPORTUNITY_CANCELLED describe ONLY a change in whether this
 * opportunity currently accepts NEW paid orders. A future consumer of
 * these events must NEVER interpret any of them as an instruction to
 * cancel, refund, or otherwise act on an existing paid order — that
 * is exclusively the responsibility of the order's own independent
 * lifecycle (Phase 7), triggered by its own reasons, never by this
 * event. The payload may grow over time (e.g. previousStatus,
 * newStatus, occurredAt) for observability, but must never gain a
 * field that reads as a command over orders (e.g. cancelOrders,
 * refundOrders) — the presence of such a field would itself be a
 * violation of this contract.
 *
 * DEFERRED TO PHASE 7 (explicitly not decided or implemented here):
 * what happens to available/sellable quantity when an individual
 * paid order is later cancelled or refunded (e.g. does the unit
 * become resellable, does target_quantity effectively grow back) is
 * entirely an order/inventory-lifecycle decision for Phase 7. What
 * IS certain and enforced now: the opportunity's own
 * expiry/pause/cancellation never reverses funded_quantity and never
 * triggers a refund by itself.
 */
export interface SweepResult {
  scheduledFinalized: number;
  expiredFromActive: number;
  expiredFromPaused: number;
  fundedSafetyNet: number;
}

export async function runOpportunityLifecycleSweep(prisma: PrismaClient): Promise<SweepResult> {
  return {
    scheduledFinalized: await runScheduledFinalizationBatches(prisma),
    expiredFromActive: await runSimpleExpiryBatches(prisma, "ACTIVE"),
    expiredFromPaused: await runSimpleExpiryBatches(prisma, "PAUSED"),
    fundedSafetyNet: await runFundedSafetyNetBatches(prisma),
  };
}

async function runScheduledFinalizationBatches(prisma: PrismaClient): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const processed = await prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM opportunities
        WHERE status = 'SCHEDULED' AND start_at <= now()
        ORDER BY start_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;
      for (const { id } of candidates) {
        await finalizeOneScheduledOpportunity(tx, id);
      }
      return candidates.length;
    });

    total += processed;
    if (processed < BATCH_SIZE) break;
  }
  return total;
}

/**
 * ACTIVE/PAUSED -> EXPIRED: closes the sales WINDOW only. The
 * funded_quantity < target_quantity guard exists purely to avoid a
 * redundant transition on a row runFundedSafetyNetBatches would
 * already claim (a row that's fully sold goes to FUNDED, not
 * EXPIRED, even past its end date) — it is not a "did this
 * opportunity succeed" check. This UPDATE never writes to
 * funded_quantity, never touches any order, and never issues a
 * refund; see the file-level contract above.
 */
async function runSimpleExpiryBatches(prisma: PrismaClient, fromStatus: "ACTIVE" | "PAUSED"): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const processed = await prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<{ id: string; company_id: string }[]>`
        WITH batch AS (
          SELECT id FROM opportunities
          -- A SHELF DOES NOT EXPIRE: a DIRECT listing holds no end_at at
          -- all, so naming the mode states the rule rather than leaving
          -- a NULL comparison to imply it.
          WHERE status = ${fromStatus}::"OpportunityStatus" AND sale_mode = 'GROUP'
            AND end_at <= now() AND funded_quantity < target_quantity
          ORDER BY end_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE opportunities o SET status = 'EXPIRED', updated_at = now()
        FROM batch WHERE o.id = batch.id
        RETURNING o.id, o.company_id
      `;

      for (const row of expired) {
        const requestId = `system-sweep-${row.id}-${Date.now()}`;
        await tx.auditLog.create({
          data: {
            actorType: AuditActorType.SYSTEM,
            companyId: row.company_id,
            action: "OPPORTUNITY_EXPIRED",
            entityType: "opportunity",
            entityId: row.id,
            requestId,
          },
        });
        await tx.outboxEvent.create({
          data: {
            eventType: "OPPORTUNITY_EXPIRED",
            payload: { opportunityId: row.id } as Prisma.InputJsonValue,
          },
        });
      }
      return expired.length;
    });

    total += processed;
    if (processed < BATCH_SIZE) break;
  }
  return total;
}

/**
 * ACTIVE -> FUNDED: the supply cap has been fully sold
 * (funded_quantity >= target_quantity). This is a "sold out, stop
 * selling more" transition — it stops NEW sales only. This UPDATE
 * never writes to funded_quantity itself (it only reads the
 * already-correct value written elsewhere, by the future Checkout
 * payment-success path), so it can never reset or reverse it. Named
 * a "safety net" because the primary path to FUNDED is expected to be
 * the payment-success write itself detecting it has just reached the
 * cap; this sweep exists to catch any row that slipped through.
 *
 * A GROUP OFFER ONLY, AND THIS IS NOT A DETAIL.
 *
 * «إذا أصبح المتاح صفرًا تبقى النشرة ACTIVE وتظهر نفد المخزون، وعند
 *  إضافة مخزون تعود قابلة للشراء.» A direct listing whose last unit
 * sold satisfies `funded_quantity >= target_quantity` exactly as a
 * filled group offer does — and it means something entirely different:
 * the shelf is empty, not the sale finished. Swept to FUNDED it would
 * enter a status that is TERMINAL in `OPPORTUNITY_TRANSITIONS`, and
 * restocking it would be impossible.
 *
 * WITHOUT THE MODE FILTER THIS SWEEP THROWS, every minute, on every
 * sold-out direct listing: `opportunities_sale_mode_status` refuses
 * FUNDED on such a row, the batch's transaction rolls back, and the
 * expiry work in the same run is lost with it. The constraint caught
 * it; the filter is what stops it being caught.
 */
async function runFundedSafetyNetBatches(prisma: PrismaClient): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const processed = await prisma.$transaction(async (tx) => {
      const funded = await tx.$queryRaw<{ id: string; company_id: string }[]>`
        WITH batch AS (
          SELECT id FROM opportunities
          WHERE status = 'ACTIVE' AND sale_mode = 'GROUP'
            AND funded_quantity >= target_quantity
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE opportunities o SET status = 'FUNDED', updated_at = now()
        FROM batch WHERE o.id = batch.id
        RETURNING o.id, o.company_id
      `;

      for (const row of funded) {
        const requestId = `system-sweep-${row.id}-${Date.now()}`;
        await tx.auditLog.create({
          data: {
            actorType: AuditActorType.SYSTEM,
            companyId: row.company_id,
            action: "OPPORTUNITY_FUNDED",
            entityType: "opportunity",
            entityId: row.id,
            requestId,
          },
        });
        await tx.outboxEvent.create({
          data: {
            eventType: "OPPORTUNITY_FUNDED",
            payload: { opportunityId: row.id } as Prisma.InputJsonValue,
          },
        });
      }
      return funded.length;
    });

    total += processed;
    if (processed < BATCH_SIZE) break;
  }
  return total;
}
