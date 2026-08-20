import { randomUUID } from "crypto";
import { AuditActorType, type Prisma, type PrismaClient } from "@prisma/client";
import { evaluateLiveEligibility } from "./eligibility";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Finalizes ONE already row-locked (FOR UPDATE, within the caller's
 * transaction) SCHEDULED opportunity: re-verifies live eligibility,
 * then either activates it or moves it to ACTION_REQUIRED — status
 * change, audit_logs, and outbox_events all execute using the SAME
 * transaction client passed in, so nothing commits independently of
 * the row lock being held.
 */
export async function finalizeOneScheduledOpportunity(tx: Tx, id: string): Promise<"ACTIVATED" | "BLOCKED"> {
  const opp = await tx.opportunity.findUniqueOrThrow({
    where: { id },
    include: {
      product: { select: { approvalStatus: true, archivedAt: true } },
      fulfillmentLocation: { select: { isActive: true, city: { select: { isActive: true } } } },
      company: {
        select: {
          verificationStatus: true,
          activeBankAccount: { select: { verificationStatus: true } },
          taxProfile: { select: { id: true } },
          invoicingProfile: { select: { id: true } },
        },
      },
    },
  });

  const blocker = evaluateLiveEligibility(opp);
  const requestId = `system-sweep-${randomUUID()}`;

  if (blocker) {
    await tx.$executeRaw`
      UPDATE opportunities
      SET status = 'ACTION_REQUIRED', reason_code = ${blocker.code}, reason_details = ${blocker.details},
          blocked_at = now(), updated_at = now()
      WHERE id = ${id}::uuid AND status = 'SCHEDULED'
    `;
    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        companyId: opp.companyId,
        action: "OPPORTUNITY_ACTION_REQUIRED",
        entityType: "opportunity",
        entityId: id,
        reason: blocker.details,
        requestId,
      },
    });
    await tx.outboxEvent.create({
      data: {
        eventType: "OPPORTUNITY_ACTION_REQUIRED",
        payload: { opportunityId: id, reasonCode: blocker.code } as Prisma.InputJsonValue,
      },
    });
    return "BLOCKED";
  }

  await tx.$executeRaw`
    UPDATE opportunities
    SET status = 'ACTIVE', first_activated_at = COALESCE(first_activated_at, now()), updated_at = now()
    WHERE id = ${id}::uuid AND status = 'SCHEDULED'
  `;
  await tx.auditLog.create({
    data: {
      actorType: AuditActorType.SYSTEM,
      companyId: opp.companyId,
      action: "OPPORTUNITY_ACTIVATED",
      entityType: "opportunity",
      entityId: id,
      requestId,
    },
  });
  await tx.outboxEvent.create({
    data: {
      eventType: "OPPORTUNITY_ACTIVATED",
      payload: { opportunityId: id } as Prisma.InputJsonValue,
      idempotencyKey: `OPPORTUNITY_ACTIVATED:${id}`,
    },
  });
  return "ACTIVATED";
}
