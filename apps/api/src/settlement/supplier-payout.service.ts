import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { isOrderAllocationSettlementEligible } from "@platform/domain";
import { PrismaService } from "../database/prisma.service";
import { NotificationEventsService } from "../notifications/notification-events.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

interface AdminActorContext {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SupplierPayoutResult {
  supplierPayoutId: string;
  orderAllocationId: string;
  outcome: "EXECUTED" | "ZERO_BALANCE";
  netAmount: number;
  externalTransferReference: string | null;
}

const IDEMPOTENCY_SCOPE = "SUPPLIER_PAYOUT";
const IDEMPOTENCY_TTL_HOURS = 24;
const MAX_RETRY = 3;

@Injectable()
export class SupplierPayoutService {
  constructor(private readonly prisma: PrismaService,
    private readonly notifications: NotificationEventsService
  ) {}

  /**
   * Admin-only. Idempotency-Key is mandatory and scoped to the
   * OrderAllocation (via the key value itself, chosen by the
   * caller/controller as e.g. `settle:<orderAllocationId>:<nonce>`).
   * Replaying the exact same request returns the same SupplierPayout;
   * the same key with a different body is rejected outright.
   */
  async settle(
    orderAllocationId: string,
    input: { externalTransferReference?: string },
    ctx: AdminActorContext,
    idempotencyKey: string
  ): Promise<SupplierPayoutResult> {
    const requestHash = JSON.stringify({ orderAllocationId, externalTransferReference: input.externalTransferReference ?? null });

    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
          VALUES (${IDEMPOTENCY_SCOPE}, ${idempotencyKey}, ${requestHash}, 'IN_PROGRESS', now() + interval '${Prisma.raw(String(IDEMPOTENCY_TTL_HOURS))} hours', now())
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING id
        `;

        if (claimed.length > 0) {
          const result = await this.settleTx(tx, orderAllocationId, input, ctx);
          await tx.$executeRaw`
            UPDATE idempotency_keys SET status = 'COMPLETED', response_snapshot = ${JSON.stringify(result)}::jsonb, updated_at = now()
            WHERE scope = ${IDEMPOTENCY_SCOPE} AND key = ${idempotencyKey}
          `;
          return { kind: "created" as const, result };
        }

        const existing = await tx.$queryRaw<
          { status: string; request_hash: string; response_snapshot: unknown }[]
        >`SELECT status, request_hash, response_snapshot FROM idempotency_keys WHERE scope = ${IDEMPOTENCY_SCOPE} AND key = ${idempotencyKey} FOR UPDATE`;

        if (existing.length === 0) return { kind: "retry" as const };
        const row = existing[0];
        if (row.status !== "COMPLETED") return { kind: "retry" as const };
        if (row.request_hash !== requestHash) {
          throw new BusinessException(409, ERROR_CODES.CONFLICT, "This idempotency key was already used with a different request");
        }
        return { kind: "existing" as const, result: row.response_snapshot as SupplierPayoutResult };
      });

      if (outcome.kind !== "retry") return outcome.result;
    }
    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not process the settlement under concurrent load");
  }

  private async settleTx(
    tx: Prisma.TransactionClient,
    orderAllocationId: string,
    input: { externalTransferReference?: string },
    ctx: AdminActorContext
  ): Promise<SupplierPayoutResult> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM order_allocations WHERE id = ${orderAllocationId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException("Order allocation not found");

    const allocation = await tx.orderAllocation.findUniqueOrThrow({
      where: { id: orderAllocationId },
      include: { masterOrder: true, financialSnapshot: true },
    });
    const supplierCompany = await tx.company.findUniqueOrThrow({ where: { id: allocation.masterOrder.supplierCompanyId } });

    const hasOpenDispute = (await tx.dispute.count({
      where: { orderAllocationId, status: { in: ["OPEN", "SUPPLIER_RESPONDED", "AWAITING_REPLACEMENT"] } },
    })) > 0;

    const hasBlockingRefundObligation = (await tx.refundObligation.count({
      where: {
        source: "DISPUTE",
        status: { in: ["PENDING_EXECUTION", "SENT", "FAILED"] },
        disputeDecision: { dispute: { orderAllocationId } },
      },
    })) > 0;

    const eligible = isOrderAllocationSettlementEligible({
      status: allocation.status,
      disputeWindowClosesAt: allocation.disputeWindowClosesAt,
      payoutSettledAt: allocation.payoutSettledAt,
      hasOpenDispute,
      hasBlockingRefundObligation,
      supplierCompanyPayoutHoldUntil: supplierCompany.payoutHoldUntil,
      now: new Date(),
    });
    if (!eligible) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "This allocation is not eligible for settlement");
    }
    if (!allocation.financialSnapshot) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "No financial snapshot for this allocation");
    }

    const snapshot = allocation.financialSnapshot;

    const productDebits = await tx.$queryRaw<{ sum: string | null }[]>`
      SELECT SUM(lp."amount")::text AS sum
      FROM ledger_postings lp
      JOIN journal_entries je ON je."id" = lp."journal_entry_id"
      JOIN refund_obligations ro ON ro."id" = je."reference_id" AND je."reference_type" = 'refund_obligation'
      JOIN dispute_decisions dd ON dd."id" = ro."dispute_decision_id"
      JOIN disputes d ON d."id" = dd."dispute_id"
      WHERE d."order_allocation_id" = ${orderAllocationId}::uuid
        AND lp."account" = 'SUPPLIER_PAYABLE' AND lp."direction" = 'DEBIT'
        AND je."event_type" = 'DISPUTE_REFUND_OBLIGATION'
    `;
    const shippingDebits = await tx.$queryRaw<{ sum: string | null }[]>`
      SELECT SUM(lp."amount")::text AS sum
      FROM ledger_postings lp
      JOIN journal_entries je ON je."id" = lp."journal_entry_id"
      JOIN refund_obligations ro ON ro."id" = je."reference_id" AND je."reference_type" = 'refund_obligation'
      JOIN dispute_decisions dd ON dd."id" = ro."dispute_decision_id"
      JOIN disputes d ON d."id" = dd."dispute_id"
      WHERE d."order_allocation_id" = ${orderAllocationId}::uuid
        AND lp."account" = 'SHIPPING_LIABILITY' AND lp."direction" = 'DEBIT'
        AND je."event_type" = 'DISPUTE_REFUND_OBLIGATION'
    `;

    const sumProductDebits = Number(productDebits[0]?.sum ?? 0);
    const sumShippingDebits = Number(shippingDebits[0]?.sum ?? 0);

    const productNet = round2(Number(snapshot.supplierPayableShareAmount) - sumProductDebits);
    const shippingNet = round2(Number(snapshot.shippingFeeAmount) - sumShippingDebits);
    const netAmount = round2(productNet + shippingNet);

    if (productNet < 0 || shippingNet < 0 || netAmount < 0) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "Computed settlement amount is negative — refuse to settle");
    }

    const supplierBankAccountId = allocation.masterOrder.supplierBankAccountId;
    const outcome: "EXECUTED" | "ZERO_BALANCE" = netAmount > 0 ? "EXECUTED" : "ZERO_BALANCE";

    let externalTransferReference: string | null = null;
    if (outcome === "EXECUTED") {
      if (!input.externalTransferReference || input.externalTransferReference.trim().length === 0) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "externalTransferReference is required for a non-zero settlement");
      }
      externalTransferReference = input.externalTransferReference.trim().toUpperCase();
    }

    let payout: { id: string };
    try {
      payout = await tx.supplierPayout.create({
        data: {
          orderAllocationId,
          outcome,
          externalTransferReference,
          netAmount,
          supplierBankAccountId,
          executedByAdminUserId: ctx.userId,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This external transfer reference has already been used");
      }
      throw err;
    }

    if (outcome === "EXECUTED") {
      const journal = await tx.journalEntry.create({
        data: {
          eventType: "SUPPLIER_SETTLEMENT",
          referenceType: "supplier_payout",
          referenceId: payout.id,
          idempotencyKey: `settlement:${payout.id}`,
        },
      });
      const postings: { journalEntryId: string; account: "SUPPLIER_PAYABLE" | "SHIPPING_LIABILITY" | "CASH_CLEARING"; direction: "DEBIT" | "CREDIT"; amount: number }[] = [];
      if (productNet > 0) postings.push({ journalEntryId: journal.id, account: "SUPPLIER_PAYABLE", direction: "DEBIT", amount: productNet });
      if (shippingNet > 0) postings.push({ journalEntryId: journal.id, account: "SHIPPING_LIABILITY", direction: "DEBIT", amount: shippingNet });
      postings.push({ journalEntryId: journal.id, account: "CASH_CLEARING", direction: "CREDIT", amount: netAmount });
      await tx.ledgerPosting.createMany({ data: postings });
    }

    await this.emit(tx, ctx, "SUPPLIER_PAYOUT_" + outcome, "supplier_payout", payout.id);

    // EXECUTED only: a ZERO_BALANCE payout moved no money, and
    // announcing it would be noise.
    if (outcome === "EXECUTED") {
      await this.notifications.settlementExecuted(tx, {
        supplierPayoutId: payout.id,
        supplierCompanyId: await this.supplierCompanyIdForPayout(tx, payout.id),
        netAmount,
        currency: "SAR",
      });
    }

    await tx.$executeRaw`UPDATE order_allocations SET payout_settled_at = now() WHERE id = ${orderAllocationId}::uuid AND payout_settled_at IS NULL`;

    await tx.$executeRawUnsafe(
      `SET CONSTRAINTS trg_check_journal_entry_balance, trg_check_payout_settled_has_supplier_payout, trg_check_supplier_payout_has_payout_settled, trg_check_supplier_payout_journal_consistency, trg_check_supplier_payout_bank_account_frozen IMMEDIATE`
    );

    return {
      supplierPayoutId: payout.id,
      orderAllocationId,
      outcome,
      netAmount,
      externalTransferReference,
    };
  }

  private async emit(tx: Prisma.TransactionClient, ctx: AdminActorContext, action: string, entityType: string, entityId: string): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.USER,
        actorId: ctx.userId,
        action,
        entityType,
        entityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    await tx.outboxEvent.create({ data: { eventType: action, payload: { entityType, entityId } as Prisma.InputJsonValue } });
  }
  /** Resolved from the payout's own allocation, never from the request. */
  private async supplierCompanyIdForPayout(
    tx: Prisma.TransactionClient,
    supplierPayoutId: string
  ): Promise<string> {
    const payout = await tx.supplierPayout.findUniqueOrThrow({
      where: { id: supplierPayoutId },
      select: { orderAllocation: { select: { masterOrder: { select: { supplierCompanyId: true } } } } },
    });
    return payout.orderAllocation.masterOrder.supplierCompanyId;
  }}

function round2(n: number): number {
  return Math.round(n * 100) / 100;


}
