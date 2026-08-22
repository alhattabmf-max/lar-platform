import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { NotificationEventsService } from "../notifications/notification-events.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { RefundProviderRegistry } from "./providers/refund-provider.registry";
import type { VerifiedRefundWebhookPayload } from "./providers/refund-provider.interface";
import { RefundExecutionService } from "./refund-execution.service";

const MAX_RETRY = 3;
const IDEMPOTENCY_TTL_HOURS = 24;

type WebhookOutcome =
  | { processingOutcome: "SUCCEEDED" }
  | { processingOutcome: "DEFINITIVE_FAILED" }
  | { processingOutcome: "IGNORED_OUT_OF_ORDER" }
  | { processingOutcome: "DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION" }
  | { processingOutcome: "RECORDED" };

@Injectable()
export class RefundWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RefundProviderRegistry,
    private readonly execution: RefundExecutionService,
    private readonly notifications: NotificationEventsService
  ) {}

  async handleWebhook(providerParam: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookOutcome> {
    const provider = this.registry.get(providerParam);
    if (!provider) throw new NotFoundException("Unknown refund provider");

    const parsed = provider.verifyAndParseWebhook(rawBody, headers);
    if (!parsed) throw new UnauthorizedException("Invalid webhook signature");

    if (parsed.providerCode !== providerParam || parsed.providerCode !== provider.providerCode) {
      throw new UnauthorizedException("Provider mismatch between URL, provider, and payload");
    }

    const scope = `REFUND_WEBHOOK:${parsed.providerCode}`;
    const key = parsed.providerEventId;

    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
          VALUES (${scope}, ${key}, ${parsed.payloadHash}, 'IN_PROGRESS', now() + interval '${Prisma.raw(String(IDEMPOTENCY_TTL_HOURS))} hours', now())
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING id
        `;

        if (claimed.length > 0) {
          const result = await this.processEventTx(tx, parsed);
          await tx.$executeRaw`
            UPDATE idempotency_keys SET status = 'COMPLETED', response_snapshot = ${JSON.stringify(result)}::jsonb, updated_at = now()
            WHERE scope = ${scope} AND key = ${key}
          `;
          return { kind: "created" as const, result };
        }

        const existing = await tx.$queryRaw<
          { status: string; request_hash: string; response_snapshot: unknown }[]
        >`SELECT status, request_hash, response_snapshot FROM idempotency_keys WHERE scope = ${scope} AND key = ${key} FOR UPDATE`;

        if (existing.length === 0) return { kind: "retry" as const };
        const row = existing[0];
        if (row.status !== "COMPLETED") return { kind: "retry" as const };
        if (row.request_hash !== parsed.payloadHash) {
          return { kind: "hash_mismatch" as const };
        }
        return { kind: "existing" as const, result: row.response_snapshot as WebhookOutcome };
      });

      if (outcome.kind !== "retry") {
        if (outcome.kind === "hash_mismatch") {
          // Safe security audit: identifiers only, never the raw
          // payload or signature — written as its own statement (not
          // inside the aborted transaction) so it persists.
          await this.prisma.auditLog.create({
            data: {
              actorType: AuditActorType.SYSTEM,
              action: "REFUND_WEBHOOK_EVENT_ID_HASH_MISMATCH",
              entityType: "refund_provider_event",
              entityId: key,
              requestId: `refund-webhook-${key}`,
            },
          });
          throw new BusinessException(409, ERROR_CODES.CONFLICT, "This provider event id was already recorded with different content");
        }
        return outcome.result;
      }
    }

    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not process refund webhook under concurrent load");
  }

  private async processEventTx(tx: Prisma.TransactionClient, parsed: VerifiedRefundWebhookPayload): Promise<WebhookOutcome> {
    const attempt = await tx.refundAttempt.findUnique({ where: { id: parsed.merchantReference } });
    if (!attempt) {
      throw new BusinessException(404, ERROR_CODES.VALIDATION_FAILED, "No matching refund attempt for this webhook");
    }

    if (attempt.providerReference === null) {
      await tx.refundAttempt.update({ where: { id: attempt.id }, data: { providerReference: parsed.providerReference } });
    } else if (attempt.providerReference !== parsed.providerReference) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "providerReference mismatch — this webhook does not correspond to the recorded attempt");
    }

    const obligation = await tx.refundObligation.findUniqueOrThrow({ where: { id: attempt.refundObligationId } });
    if (parsed.currency !== obligation.currency) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "Currency mismatch between webhook and refund obligation");
    }
    if (parsed.amount !== undefined && Math.round(parsed.amount * 100) !== Math.round(Number(obligation.amount) * 100)) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "Amount mismatch between webhook and refund obligation");
    }

    if (parsed.eventType === "SUCCESS") {
      const completion = await this.execution.completeRefundSuccessTx(tx, attempt.id, { requestId: `refund-webhook-${parsed.providerEventId}` });
      const eventOutcome = completion.outcome === "DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION" ? "DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION" : "SUCCEEDED";
      await this.recordProviderEvent(tx, attempt.id, parsed, eventOutcome);
      if (completion.outcome === "DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION") {
        return { processingOutcome: "DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION" };
      }
      return { processingOutcome: "SUCCEEDED" };
    }

    if (attempt.status === "SUCCEEDED") {
      await this.recordProviderEvent(tx, attempt.id, parsed, "IGNORED_OUT_OF_ORDER");
      return { processingOutcome: "IGNORED_OUT_OF_ORDER" };
    }
    if (attempt.status === "DEFINITIVE_FAILED") {
      await this.recordProviderEvent(tx, attempt.id, parsed, "RECORDED");
      return { processingOutcome: "RECORDED" };
    }

    await tx.$executeRaw`UPDATE refund_attempts SET status = 'DEFINITIVE_FAILED', failure_reason = 'provider webhook reported failure' WHERE id = ${attempt.id}::uuid AND status IN ('CREATED', 'PENDING')`;
    await tx.$executeRaw`UPDATE refund_obligations SET status = 'FAILED' WHERE id = ${attempt.refundObligationId}::uuid AND status IN ('PENDING_EXECUTION', 'SENT')`;
    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        action: "REFUND_ATTEMPT_DEFINITIVE_FAILED",
        entityType: "refund_attempt",
        entityId: attempt.id,
        requestId: `refund-webhook-${parsed.providerEventId}`,
      },
    });
    await tx.outboxEvent.create({ data: { eventType: "REFUND_ATTEMPT_DEFINITIVE_FAILED", payload: { refundAttemptId: attempt.id } as Prisma.InputJsonValue } });
    await this.notifications.refundFailed(tx, {
      refundObligationId: attempt.refundObligationId,
      refundAttemptId: attempt.id,
    });

    await this.recordProviderEvent(tx, attempt.id, parsed, "DEFINITIVE_FAILED");
    return { processingOutcome: "DEFINITIVE_FAILED" };
  }

  private async recordProviderEvent(
    tx: Prisma.TransactionClient,
    refundAttemptId: string,
    parsed: VerifiedRefundWebhookPayload,
    outcome: "RECORDED" | "SUCCEEDED" | "DEFINITIVE_FAILED" | "IGNORED_OUT_OF_ORDER" | "DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION"
  ): Promise<void> {
    await tx.refundProviderEvent.create({
      data: {
        refundAttemptId,
        providerCode: parsed.providerCode,
        providerEventId: parsed.providerEventId,
        eventType: parsed.eventType,
        processingOutcome: outcome,
        payloadHash: parsed.payloadHash,
      },
    });
  }
}
