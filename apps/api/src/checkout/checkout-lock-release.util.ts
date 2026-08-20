import type { Prisma } from "@prisma/client";

/**
 * Releases every currently-ACTIVE lock (lock_released_at IS NULL) on
 * the given opportunity to ABANDONED with release_reason=
 * OPPORTUNITY_CANCELLED. Deliberately a plain function over `tx`
 * rather than an injectable service — callers (AdminOpportunitiesService,
 * AdminProductsService) already run their own atomic transaction for
 * the opportunity's own CANCELLED transition; this must execute
 * inside that SAME transaction, never a separate one, so the race
 * documented in the 7B plan resolves correctly: whichever side (a
 * competing lock-create vs this cancellation) commits first wins, and
 * an opportunity transitioning to CANCELLED always releases whatever
 * lock existed at that exact moment.
 */
export async function releaseActiveLocksForOpportunityTx(
  tx: Prisma.TransactionClient,
  opportunityId: string
): Promise<{ id: string; traderCompanyId: string }[]> {
  const released = await tx.$queryRaw<{ id: string; traderCompanyId: string }[]>`
    UPDATE checkout_sessions
    SET status = 'ABANDONED', lock_released_at = now(), release_reason = 'OPPORTUNITY_CANCELLED'
    WHERE opportunity_id = ${opportunityId}::uuid AND lock_released_at IS NULL
    RETURNING id, trader_company_id AS "traderCompanyId"
  `;

  for (const row of released) {
    await tx.auditLog.create({
      data: {
        actorType: "SYSTEM",
        companyId: row.traderCompanyId,
        action: "CHECKOUT_LOCK_ABANDONED",
        entityType: "checkout_session",
        entityId: row.id,
        reason: "OPPORTUNITY_CANCELLED",
        requestId: `opportunity-cancel-${opportunityId}`,
      },
    });
    await tx.outboxEvent.create({
      data: { eventType: "CHECKOUT_LOCK_ABANDONED", payload: { checkoutSessionId: row.id } as Prisma.InputJsonValue },
    });
  }

  return released;
}
