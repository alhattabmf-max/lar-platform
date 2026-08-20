import { Injectable } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { RefundProviderRegistry } from "./providers/refund-provider.registry";

interface ActorContext {
  userId?: string;
  requestId: string;
}

export type StartAttemptOutcome =
  | { outcome: "PENDING"; refundAttemptId: string; providerReference: string }
  | { outcome: "SUCCEEDED"; refundAttemptId: string; providerReference: string }
  | { outcome: "DEFINITIVE_FAILED"; refundAttemptId: string; reason: string }
  | { outcome: "RETRYABLE_UNKNOWN"; refundAttemptId: string; reason: string };

const HTTP_IDEMPOTENCY_SCOPE = "REFUND_ATTEMPT_START";
const HTTP_IDEMPOTENCY_TTL_HOURS = 24;
const HTTP_MAX_RETRY = 3;

@Injectable()
export class RefundExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RefundProviderRegistry
  ) {}

  async getObligation(refundObligationId: string) {
    return this.prisma.refundObligation.findUnique({
      where: { id: refundObligationId },
      include: { attempts: { orderBy: { createdAt: "asc" } } },
    });
  }

  /**
   * HTTP-facing entry point: adds an explicit Idempotency-Key layer
   * (same pattern as every other admin-facing service) on top of
   * startAttempt. Replaying the SAME key returns the SAME outcome;
   * the same key with a different providerCode is rejected with a
   * conflict.
   */
  async startAttemptIdempotent(refundObligationId: string, providerCode: string, ctx: ActorContext, idempotencyKey: string): Promise<StartAttemptOutcome> {
    const requestHash = JSON.stringify({ refundObligationId, providerCode });

    for (let attempt = 0; attempt < HTTP_MAX_RETRY; attempt++) {
      const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
        VALUES (${HTTP_IDEMPOTENCY_SCOPE}, ${idempotencyKey}, ${requestHash}, 'IN_PROGRESS', now() + interval '${Prisma.raw(String(HTTP_IDEMPOTENCY_TTL_HOURS))} hours', now())
        ON CONFLICT (scope, key) DO NOTHING
        RETURNING id
      `;

      if (claimed.length > 0) {
        const result = await this.startAttempt(refundObligationId, providerCode, ctx);
        await this.prisma.$executeRaw`
          UPDATE idempotency_keys SET status = 'COMPLETED', response_snapshot = ${JSON.stringify(result)}::jsonb, updated_at = now()
          WHERE scope = ${HTTP_IDEMPOTENCY_SCOPE} AND key = ${idempotencyKey}
        `;
        return result;
      }

      const existing = await this.prisma.$queryRaw<
        { status: string; request_hash: string; response_snapshot: unknown }[]
      >`SELECT status, request_hash, response_snapshot FROM idempotency_keys WHERE scope = ${HTTP_IDEMPOTENCY_SCOPE} AND key = ${idempotencyKey}`;

      if (existing.length === 0) continue;
      const row = existing[0];
      if (row.status !== "COMPLETED") continue;
      if (row.request_hash !== requestHash) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This idempotency key was already used with a different request");
      }
      return row.response_snapshot as StartAttemptOutcome;
    }
    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not start the refund attempt under concurrent load");
  }

  /**
   * TX1 (create the attempt) -> external call (OUTSIDE any
   * transaction) -> TX2 (persist the outcome). A crash at any point —
   * before the external call, during it, or after it but before TX2 —
   * is always safe to retry: calling this again for the SAME
   * RefundObligation finds the same still-CREATED/PENDING attempt
   * (the partial unique index guarantees at most one active attempt)
   * and reuses its id and idempotencyKey rather than creating a new
   * one, so the provider's own idempotency prevents a duplicate
   * transfer.
   */
  async startAttempt(refundObligationId: string, providerCode: string, ctx: ActorContext): Promise<StartAttemptOutcome> {
    const provider = this.registry.get(providerCode);
    if (!provider) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Unknown refund provider");
    }

    // TX1 — reuse an existing active attempt if one already exists
    // (retry-safe), otherwise create a new one. A new attempt is only
    // ever created when the obligation is PENDING_EXECUTION or FAILED
    // (a confirmed prior failure) — enforced by the partial unique
    // index at the DB level as the ultimate guard.
    const attempt = await this.prisma.$transaction(async (tx) => {
      const obligationRows = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM refund_obligations WHERE id = ${refundObligationId}::uuid FOR UPDATE
      `;
      if (obligationRows.length === 0) {
        throw new BusinessException(404, ERROR_CODES.NOT_FOUND, "Refund obligation not found");
      }
      const obligation = obligationRows[0];
      if (obligation.status !== "PENDING_EXECUTION" && obligation.status !== "FAILED") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This refund obligation is not eligible for a new attempt");
      }

      const existingActive = await tx.refundAttempt.findFirst({
        where: { refundObligationId, status: { in: ["CREATED", "PENDING"] } },
      });
      if (existingActive) {
        return existingActive;
      }

      const attemptId = crypto.randomUUID();
      const idempotencyKey = `REFUND_ATTEMPT:${attemptId}`;
      const created = await tx.refundAttempt.create({
        data: { id: attemptId, refundObligationId, providerCode: provider.providerCode, idempotencyKey, status: "CREATED" },
      });

      if (obligation.status === "FAILED") {
        await tx.$executeRaw`UPDATE refund_obligations SET status = 'SENT' WHERE id = ${refundObligationId}::uuid AND status = 'FAILED'`;
      }

      return created;
    });

    const obligation = await this.prisma.refundObligation.findUniqueOrThrow({ where: { id: refundObligationId } });

    // External call — deliberately OUTSIDE any DB transaction.
    const result = await provider.executeRefund({
      amount: Number(obligation.amount),
      currency: obligation.currency,
      idempotencyKey: attempt.idempotencyKey,
      merchantReference: attempt.id,
    });

    // TX2 — persist whatever the provider told us.
    return this.prisma.$transaction(async (tx) => {
      const currentAttempt = await tx.refundAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      if (currentAttempt.status !== "CREATED") {
        // Already resolved by a concurrent path (e.g. a webhook that
        // arrived before we got here) — report its current state
        // rather than re-writing anything.
        return this.mapAttemptToOutcome(currentAttempt);
      }

      if (result.outcome === "RETRYABLE_UNKNOWN") {
        // Deliberately no DB write — the same CREATED attempt and its
        // idempotencyKey are reused verbatim on the next retry.
        return { outcome: "RETRYABLE_UNKNOWN" as const, refundAttemptId: attempt.id, reason: result.reason };
      }

      if (result.outcome === "SENT") {
        await tx.refundAttempt.update({ where: { id: attempt.id }, data: { status: "PENDING", providerReference: result.providerReference } });
        await tx.$executeRaw`UPDATE refund_obligations SET status = 'SENT' WHERE id = ${refundObligationId}::uuid AND status = 'PENDING_EXECUTION'`;
        await this.emit(tx, ctx, "REFUND_ATTEMPT_SENT", "refund_attempt", attempt.id);
        return { outcome: "PENDING" as const, refundAttemptId: attempt.id, providerReference: result.providerReference };
      }

      if (result.outcome === "DEFINITIVE_FAILURE") {
        await tx.refundAttempt.update({ where: { id: attempt.id }, data: { status: "DEFINITIVE_FAILED", failureReason: result.reason } });
        await tx.$executeRaw`UPDATE refund_obligations SET status = 'FAILED' WHERE id = ${refundObligationId}::uuid AND status IN ('PENDING_EXECUTION', 'SENT')`;
        await this.emit(tx, ctx, "REFUND_ATTEMPT_DEFINITIVE_FAILED", "refund_attempt", attempt.id);
        return { outcome: "DEFINITIVE_FAILED" as const, refundAttemptId: attempt.id, reason: result.reason };
      }

      // SUCCEEDED — a synchronous confirmation from the provider.
      await tx.refundAttempt.update({ where: { id: attempt.id }, data: { providerReference: result.providerReference } });
      const completion = await this.completeRefundSuccessTx(tx, attempt.id, ctx);
      if (completion.outcome === "DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION") {
        // Should be structurally unreachable on the very first
        // synchronous confirmation, but never silently swallow it.
        throw new BusinessException(500, ERROR_CODES.CONFLICT, "Duplicate success requires manual reconciliation");
      }
      return { outcome: "SUCCEEDED" as const, refundAttemptId: attempt.id, providerReference: result.providerReference };
    });
  }

  /**
   * Shared success-completion logic (Section 4). Idempotent: replaying
   * against an attempt already SUCCEEDED returns the same outcome
   * with no further writes. Guards against a genuinely duplicate
   * success arriving for a DIFFERENT attempt after the obligation is
   * already COMPLETED — that case is never silently absorbed into a
   * phantom ledger entry; it is surfaced as a critical finance
   * incident requiring manual reconciliation.
   */
  async completeRefundSuccessTx(
    tx: Prisma.TransactionClient,
    refundAttemptId: string,
    ctx: ActorContext
  ): Promise<{ outcome: "COMPLETED" | "ALREADY_COMPLETED" | "DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION" }> {
    const attemptPreview = await tx.refundAttempt.findUniqueOrThrow({ where: { id: refundAttemptId } });
    const refundObligationId = attemptPreview.refundObligationId;

    const obligationRows = await tx.$queryRaw<{ id: string; status: string; amount: string; currency: string }[]>`
      SELECT id, status, amount, currency FROM refund_obligations WHERE id = ${refundObligationId}::uuid FOR UPDATE
    `;
    const obligation = obligationRows[0];

    const attemptRows = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM refund_attempts WHERE id = ${refundAttemptId}::uuid FOR UPDATE
    `;
    const attempt = attemptRows[0];

    if (attempt.status === "SUCCEEDED") {
      // Idempotent replay against the SAME attempt — no new writes.
      return { outcome: "ALREADY_COMPLETED" };
    }

    if (obligation.status === "COMPLETED") {
      // A genuinely different attempt succeeded after the obligation
      // was already completed by another one — a real, distinct
      // transfer that must never be hidden and must never produce a
      // second normal ledger entry for the same obligation. The
      // attempt itself STILL becomes SUCCEEDED (it is a real
      // financial fact), but the obligation is left untouched and a
      // dedicated, immutable reconciliation incident is raised
      // instead of any automatic accounting.
      const claimedDuplicateAttempt = await tx.$executeRaw`
        UPDATE refund_attempts SET status = 'SUCCEEDED' WHERE id = ${refundAttemptId}::uuid AND status IN ('CREATED', 'PENDING', 'DEFINITIVE_FAILED')
      `;
      if (Number(claimedDuplicateAttempt) === 0) {
        // Already SUCCEEDED (idempotent replay) — nothing further to do.
        return { outcome: "ALREADY_COMPLETED" };
      }

      const existingIncident = await tx.refundReconciliationIncident.findUnique({ where: { refundAttemptId } });
      if (!existingIncident) {
        const reconciliationJournal = await tx.journalEntry.create({
          data: {
            eventType: "REFUND_RECONCILIATION",
            referenceType: "refund_attempt",
            referenceId: refundAttemptId,
            idempotencyKey: `refund-reconciliation:${refundAttemptId}`,
          },
        });
        await tx.ledgerPosting.createMany({
          data: [
            { journalEntryId: reconciliationJournal.id, account: "REFUND_RECONCILIATION_RECEIVABLE", direction: "DEBIT", amount: obligation.amount },
            { journalEntryId: reconciliationJournal.id, account: "CASH_CLEARING", direction: "CREDIT", amount: obligation.amount },
          ],
        });

        await tx.refundReconciliationIncident.create({
          data: {
            refundObligationId,
            refundAttemptId,
            journalEntryId: reconciliationJournal.id,
            excessAmount: obligation.amount,
            currency: obligation.currency,
            reasonCode: "DUPLICATE_PROVIDER_REFUND",
          },
        });
        await this.emit(tx, ctx, "REFUND_DUPLICATE_SUCCESS_CRITICAL_INCIDENT", "refund_obligation", refundObligationId);

        await tx.$executeRawUnsafe(
          `SET CONSTRAINTS trg_check_journal_entry_balance, trg_check_extra_succeeded_attempts_have_incidents IMMEDIATE`
        );
      }

      return { outcome: "DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION" };
    }

    const claimedAttempt = await tx.$executeRaw`
      UPDATE refund_attempts SET status = 'SUCCEEDED' WHERE id = ${refundAttemptId}::uuid AND status IN ('CREATED', 'PENDING', 'DEFINITIVE_FAILED')
    `;
    if (Number(claimedAttempt) === 0) {
      return { outcome: "ALREADY_COMPLETED" };
    }

    const claimedObligation = await tx.$executeRaw`
      UPDATE refund_obligations SET status = 'COMPLETED' WHERE id = ${refundObligationId}::uuid AND status IN ('PENDING_EXECUTION', 'SENT', 'FAILED')
    `;
    if (Number(claimedObligation) === 0) {
      // Lost a race — another path already completed it. Do not post
      // a second journal entry.
      return { outcome: "ALREADY_COMPLETED" };
    }

    const journal = await tx.journalEntry.create({
      data: {
        eventType: "REFUND_EXECUTED",
        referenceType: "refund_obligation",
        referenceId: refundObligationId,
        idempotencyKey: `refund-executed:${refundObligationId}`,
      },
    });
    await tx.ledgerPosting.createMany({
      data: [
        { journalEntryId: journal.id, account: "CUSTOMER_REFUND_PAYABLE", direction: "DEBIT", amount: obligation.amount },
        { journalEntryId: journal.id, account: "CASH_CLEARING", direction: "CREDIT", amount: obligation.amount },
      ],
    });

    await this.emit(tx, ctx, "REFUND_COMPLETED", "refund_obligation", refundObligationId);

    await tx.$executeRawUnsafe(
      `SET CONSTRAINTS trg_check_journal_entry_balance, trg_check_refund_obligation_completed_has_succeeded_attempt, trg_check_refund_obligation_completed_has_executed_journal IMMEDIATE`
    );

    return { outcome: "COMPLETED" };
  }

  private mapAttemptToOutcome(attempt: { id: string; status: string; providerReference: string | null; failureReason: string | null }): StartAttemptOutcome {
    if (attempt.status === "PENDING") return { outcome: "PENDING", refundAttemptId: attempt.id, providerReference: attempt.providerReference ?? "" };
    if (attempt.status === "SUCCEEDED") return { outcome: "SUCCEEDED", refundAttemptId: attempt.id, providerReference: attempt.providerReference ?? "" };
    if (attempt.status === "DEFINITIVE_FAILED") return { outcome: "DEFINITIVE_FAILED", refundAttemptId: attempt.id, reason: attempt.failureReason ?? "unknown" };
    return { outcome: "RETRYABLE_UNKNOWN", refundAttemptId: attempt.id, reason: "still pending resolution" };
  }

  private async emit(tx: Prisma.TransactionClient, ctx: ActorContext, action: string, entityType: string, entityId: string): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorType: ctx.userId ? AuditActorType.USER : AuditActorType.SYSTEM,
        actorId: ctx.userId ?? null,
        action,
        entityType,
        entityId,
        requestId: ctx.requestId,
      },
    });
    await tx.outboxEvent.create({ data: { eventType: action, payload: { entityType, entityId } as Prisma.InputJsonValue } });
  }
}
