import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { computeDisputeRefundReversal } from "@platform/domain";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

const SUPPLIER_RESPONSE_WINDOW_DAYS = 3;

interface ActorContext {
  userId?: string;
  companyId?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

type DisputeDecisionType = "FULL_REFUND" | "PARTIAL_REFUND" | "REJECTED" | "REPLACEMENT";

export interface OpenDisputeInput {
  reasonCode: "ITEM_NOT_RECEIVED" | "ITEM_DAMAGED" | "ITEM_INCORRECT" | "QUANTITY_SHORTAGE" | "QUALITY_ISSUE" | "OTHER";
  description: string;
  evidenceStorageObjectKeys?: string[];
}

export interface SupplierRespondInput {
  responseType: "ACCEPT" | "REJECT" | "PARTIAL_ACCEPT" | "REPLACEMENT_OFFER";
  description: string;
}

export interface AdminDecisionInput {
  decisionType: DisputeDecisionType;
  productRefundAmountInclTax?: number;
  shippingRefundAmount?: number;
  replacementQuantity?: number;
  reasonNote: string;
}

const MIN_DESCRIPTION_LENGTH = 5;

const HTTP_IDEMPOTENCY_TTL_HOURS = 24;
const HTTP_MAX_RETRY = 3;

@Injectable()
export class DisputeService {
  constructor(private readonly prisma: PrismaService) {}

  /** HTTP-facing wrapper: adds an explicit Idempotency-Key layer around openDispute. */
  async openDisputeIdempotent(orderAllocationId: string, input: OpenDisputeInput, ctx: ActorContext, idempotencyKey: string) {
    return this.withHttpIdempotency("DISPUTE_OPEN", { orderAllocationId, input }, idempotencyKey, () => this.openDispute(orderAllocationId, input, ctx));
  }

  /** HTTP-facing wrapper: adds an explicit Idempotency-Key layer around addEvidence. */
  async addEvidenceIdempotent(disputeId: string, storageObjectKey: string, ctx: ActorContext, idempotencyKey: string) {
    return this.withHttpIdempotency("DISPUTE_EVIDENCE", { disputeId, storageObjectKey }, idempotencyKey, () => this.addEvidence(disputeId, storageObjectKey, ctx));
  }

  /** HTTP-facing wrapper: adds an explicit Idempotency-Key layer around supplierRespond. */
  async supplierRespondIdempotent(disputeId: string, input: SupplierRespondInput, ctx: ActorContext, idempotencyKey: string) {
    return this.withHttpIdempotency("DISPUTE_SUPPLIER_RESPOND", { disputeId, input }, idempotencyKey, () => this.supplierRespond(disputeId, input, ctx));
  }

  private async withHttpIdempotency<T>(scope: string, payload: unknown, idempotencyKey: string, work: () => Promise<T>): Promise<T> {
    const requestHash = JSON.stringify(payload);
    for (let attempt = 0; attempt < HTTP_MAX_RETRY; attempt++) {
      const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
        VALUES (${scope}, ${idempotencyKey}, ${requestHash}, 'IN_PROGRESS', now() + interval '${Prisma.raw(String(HTTP_IDEMPOTENCY_TTL_HOURS))} hours', now())
        ON CONFLICT (scope, key) DO NOTHING
        RETURNING id
      `;

      if (claimed.length > 0) {
        const result = await work();
        await this.prisma.$executeRaw`
          UPDATE idempotency_keys SET status = 'COMPLETED', response_snapshot = ${JSON.stringify(result)}::jsonb, updated_at = now()
          WHERE scope = ${scope} AND key = ${idempotencyKey}
        `;
        return result;
      }

      const existing = await this.prisma.$queryRaw<
        { status: string; request_hash: string; response_snapshot: unknown }[]
      >`SELECT status, request_hash, response_snapshot FROM idempotency_keys WHERE scope = ${scope} AND key = ${idempotencyKey}`;

      if (existing.length === 0) continue;
      const row = existing[0];
      if (row.status !== "COMPLETED") continue;
      if (row.request_hash !== requestHash) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This idempotency key was already used with a different request");
      }
      return row.response_snapshot as T;
    }
    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not process the request under concurrent load");
  }

  // -----------------------------------------------------------------
  // Open dispute — ONE per OrderAllocation for its entire lifetime.
  // -----------------------------------------------------------------
  async openDispute(orderAllocationId: string, input: OpenDisputeInput, ctx: ActorContext) {
    this.assertDescription(input.description);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM order_allocations WHERE id = ${orderAllocationId}::uuid FOR UPDATE
      `;
      if (rows.length === 0) throw new NotFoundException("Order allocation not found");

      const allocation = await tx.orderAllocation.findUniqueOrThrow({
        where: { id: orderAllocationId },
        include: { masterOrder: true, financialSnapshot: true, dispute: true },
      });

      if (allocation.masterOrder.traderCompanyId !== ctx.companyId) {
        throw new NotFoundException("Order allocation not found");
      }
      if (allocation.status !== "DELIVERED") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A dispute can only be opened on a delivered allocation");
      }
      if (!allocation.disputeWindowClosesAt || new Date() > allocation.disputeWindowClosesAt) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "The dispute window for this allocation has closed");
      }
      if (allocation.payoutSettledAt !== null) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This allocation has already been settled — a dispute can no longer be opened");
      }
      if (!allocation.financialSnapshot) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This allocation has no financial snapshot yet");
      }
      if (allocation.dispute) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A dispute already exists for this allocation — only one is allowed for its entire lifetime");
      }

      const supplierResponseDueAt = new Date(Date.now() + SUPPLIER_RESPONSE_WINDOW_DAYS * 86_400_000);

      const dispute = await tx.dispute.create({
        data: {
          orderAllocationId,
          openedByUserId: ctx.userId!,
          reasonCode: input.reasonCode,
          description: input.description,
          supplierResponseDueAt,
        },
      });

      const seenKeys = new Set<string>();
      for (const key of input.evidenceStorageObjectKeys ?? []) {
        if (!key || key.trim().length === 0) continue;
        if (seenKeys.has(key)) {
          throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Duplicate evidence storageObjectKey in the same request");
        }
        seenKeys.add(key);
        await this.claimEvidenceUploadTx(tx, key, dispute.id, ctx.userId!);
        await tx.disputeEvidence.create({ data: { disputeId: dispute.id, storageObjectKey: key, uploadedByUserId: ctx.userId! } });
      }

      await this.emit(tx, ctx, "DISPUTE_OPENED", "dispute", dispute.id);

      return dispute;
    });
  }

  // -----------------------------------------------------------------
  // Add evidence — Append-only, allowed only while OPEN, no supplier
  // response yet, and before the response deadline.
  // -----------------------------------------------------------------
  async addEvidence(disputeId: string, storageObjectKey: string, ctx: ActorContext) {
    if (!storageObjectKey || storageObjectKey.trim().length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "storageObjectKey is required");
    }

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM disputes WHERE id = ${disputeId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException("Dispute not found");

      const dispute = await tx.dispute.findUniqueOrThrow({
        where: { id: disputeId },
        include: { orderAllocation: { include: { masterOrder: true } }, supplierResponse: true },
      });

      if (dispute.orderAllocation.masterOrder.traderCompanyId !== ctx.companyId) {
        throw new NotFoundException("Dispute not found");
      }
      if (dispute.status !== "OPEN") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "Evidence can only be added while the dispute is OPEN");
      }
      if (dispute.supplierResponse) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "Evidence can no longer be added — the supplier has already responded");
      }
      if (new Date() > dispute.supplierResponseDueAt) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "Evidence can no longer be added — the supplier response deadline has passed");
      }

      const existing = await tx.disputeEvidence.findFirst({ where: { disputeId, storageObjectKey } });
      if (existing) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This exact evidence file has already been submitted for this dispute");
      }

      await this.claimEvidenceUploadTx(tx, storageObjectKey, disputeId, ctx.userId!);

      const evidence = await tx.disputeEvidence.create({ data: { disputeId, storageObjectKey, uploadedByUserId: ctx.userId! } });
      await this.emit(tx, ctx, "DISPUTE_EVIDENCE_ADDED", "dispute", disputeId);

      return evidence;
    });
  }

  // -----------------------------------------------------------------
  // Supplier response — ONE final response per dispute.
  // -----------------------------------------------------------------
  async supplierRespond(disputeId: string, input: SupplierRespondInput, ctx: ActorContext) {
    this.assertDescription(input.description);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM disputes WHERE id = ${disputeId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException("Dispute not found");

      const dispute = await tx.dispute.findUniqueOrThrow({
        where: { id: disputeId },
        include: { orderAllocation: { include: { masterOrder: true } }, supplierResponse: true },
      });

      if (dispute.orderAllocation.masterOrder.supplierCompanyId !== ctx.companyId) {
        throw new NotFoundException("Dispute not found");
      }
      if (dispute.status !== "OPEN") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A response can only be submitted while the dispute is OPEN");
      }
      if (new Date() > dispute.supplierResponseDueAt) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "The response deadline for this dispute has passed");
      }
      if (dispute.supplierResponse) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A response has already been submitted for this dispute — only one is allowed");
      }

      const response = await tx.disputeSupplierResponse.create({
        data: { disputeId, responseType: input.responseType, description: input.description, respondedByUserId: ctx.userId! },
      });

      await tx.dispute.update({ where: { id: disputeId }, data: { status: "SUPPLIER_RESPONDED" } });

      await this.emit(tx, ctx, "DISPUTE_SUPPLIER_RESPONDED", "dispute", disputeId);

      return response;
    });
  }

  // -----------------------------------------------------------------
  // Admin decision — idempotent, locked, sequenceNumber IN (1,2).
  // -----------------------------------------------------------------
  async adminDecide(
    disputeId: string,
    input: AdminDecisionInput,
    ctx: ActorContext,
    idempotencyKey: string
  ): Promise<{ disputeId: string; decisionId: string; sequenceNumber: number; decisionType: DisputeDecisionType }> {
    if (!input.reasonNote || input.reasonNote.trim().length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "reasonNote is required");
    }

    const scope = "DISPUTE_DECISION";
    for (let attempt = 0; attempt < 3; attempt++) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
          VALUES (${scope}, ${idempotencyKey}, ${JSON.stringify(input)}, 'IN_PROGRESS', now() + interval '24 hours', now())
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING id
        `;

        if (claimed.length > 0) {
          const result = await this.executeDecisionTx(tx, disputeId, input, ctx);
          await tx.$executeRaw`
            UPDATE idempotency_keys SET status = 'COMPLETED', response_snapshot = ${JSON.stringify(result)}::jsonb, updated_at = now()
            WHERE scope = ${scope} AND key = ${idempotencyKey}
          `;
          return { kind: "created" as const, result };
        }

        const existing = await tx.$queryRaw<{ status: string; request_hash: string; response_snapshot: unknown }[]>`
          SELECT status, request_hash, response_snapshot FROM idempotency_keys WHERE scope = ${scope} AND key = ${idempotencyKey} FOR UPDATE
        `;
        if (existing.length === 0) return { kind: "retry" as const };
        const row = existing[0];
        if (row.status !== "COMPLETED") return { kind: "retry" as const };
        if (row.request_hash !== JSON.stringify(input)) {
          throw new BusinessException(409, ERROR_CODES.CONFLICT, "This idempotency key was already used with a different request");
        }
        return { kind: "existing" as const, result: row.response_snapshot as { disputeId: string; decisionId: string; sequenceNumber: number; decisionType: DisputeDecisionType } };
      });

      if (outcome.kind !== "retry") return outcome.result;
    }
    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not process the decision under concurrent load");
  }

  private async executeDecisionTx(tx: Prisma.TransactionClient, disputeId: string, input: AdminDecisionInput, ctx: ActorContext) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM disputes WHERE id = ${disputeId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException("Dispute not found");

    const dispute = await tx.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      include: {
        orderAllocation: { include: { masterOrder: true, financialSnapshot: true } },
        supplierResponse: true,
        decisions: { include: { replacementObligation: true }, orderBy: { sequenceNumber: "asc" } },
      },
    });

    if (dispute.status !== "OPEN" && dispute.status !== "SUPPLIER_RESPONDED" && dispute.status !== "AWAITING_REPLACEMENT") {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "This dispute has already been resolved");
    }
    if (dispute.status === "AWAITING_REPLACEMENT" && dispute.decisions.length !== 1) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "Invalid dispute state for a decision");
    }
    if (dispute.status !== "AWAITING_REPLACEMENT" && !dispute.supplierResponse && new Date() <= dispute.supplierResponseDueAt) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "Cannot decide before the supplier responds or the response deadline passes");
    }

    let sequenceNumber: number;
    if (dispute.decisions.length === 0) {
      sequenceNumber = 1;
    } else if (dispute.decisions.length === 1) {
      const first = dispute.decisions[0];
      if (first.decisionType !== "REPLACEMENT" || !first.replacementObligation) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A second decision is only allowed after a failed REPLACEMENT");
      }
      // Lock order: Dispute is already locked (above); now lock the
      // ReplacementObligation row too before reading its status, so
      // this check can never race against a concurrent mark-failed or
      // delivery confirmation.
      const roRows = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM replacement_obligations WHERE id = ${first.replacementObligation.id}::uuid FOR UPDATE
      `;
      const replacementStatus = roRows[0]?.status ?? null;
      if (replacementStatus !== "FAILED") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A second decision is only allowed after a failed REPLACEMENT");
      }
      if (input.decisionType !== "FULL_REFUND" && input.decisionType !== "PARTIAL_REFUND") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "The second decision after a failed replacement must be a refund");
      }
      sequenceNumber = 2;
    } else {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "This dispute already has two decisions — no further decision is allowed");
    }

    const snapshot = dispute.orderAllocation.financialSnapshot;
    if (!snapshot) throw new BusinessException(409, ERROR_CODES.CONFLICT, "No financial snapshot for this allocation");

    let productRefund: number | null = null;
    let shippingRefund: number | null = null;

    if (input.decisionType === "FULL_REFUND") {
      productRefund = Number(snapshot.productAmountInclTax);
      shippingRefund = Number(snapshot.shippingFeeAmount);
    } else if (input.decisionType === "PARTIAL_REFUND") {
      if (input.productRefundAmountInclTax === undefined || input.shippingRefundAmount === undefined) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "productRefundAmountInclTax and shippingRefundAmount are required for a partial refund");
      }
      if (input.productRefundAmountInclTax < 0 || input.productRefundAmountInclTax > Number(snapshot.productAmountInclTax)) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "productRefundAmountInclTax is out of bounds");
      }
      if (input.shippingRefundAmount < 0 || input.shippingRefundAmount > Number(snapshot.shippingFeeAmount)) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "shippingRefundAmount is out of bounds");
      }
      productRefund = input.productRefundAmountInclTax;
      shippingRefund = input.shippingRefundAmount;
    } else if (input.decisionType === "REPLACEMENT") {
      const originalQuantity = dispute.orderAllocation.checkoutLocationAllocationId
        ? (await tx.checkoutLocationAllocation.findUniqueOrThrow({ where: { id: dispute.orderAllocation.checkoutLocationAllocationId } })).quantity
        : 0;
      if (!input.replacementQuantity || input.replacementQuantity <= 0 || input.replacementQuantity > originalQuantity) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "replacementQuantity must be between 1 and the original allocation quantity");
      }
    }

    const decision = await tx.disputeDecision.create({
      data: {
        disputeId,
        sequenceNumber,
        decisionType: input.decisionType,
        productRefundAmountInclTax: productRefund,
        shippingRefundAmount: shippingRefund,
        reasonNote: input.reasonNote.trim(),
        decidedByAdminUserId: ctx.userId!,
      },
    });

    if (input.decisionType === "REJECTED") {
      await tx.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED_REJECTED" } });
    } else if (input.decisionType === "REPLACEMENT") {
      await tx.replacementObligation.create({
        data: {
          disputeDecisionId: decision.id,
          originalOrderAllocationId: dispute.orderAllocationId,
          replacementQuantity: input.replacementQuantity!,
        },
      });
      await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_replacement_quantity_within_original IMMEDIATE`);
      await tx.dispute.update({ where: { id: disputeId }, data: { status: "AWAITING_REPLACEMENT" } });
    } else {
      // FULL_REFUND / PARTIAL_REFUND
      const reversal = computeDisputeRefundReversal({
        productRefundAmountInclTax: productRefund!,
        shippingRefundAmount: shippingRefund!,
        snapshotProductAmountInclTax: Number(snapshot.productAmountInclTax),
        snapshotCommissionShareAmount: Number(snapshot.commissionShareAmount),
        snapshotCommissionShareTaxAmount: Number(snapshot.commissionShareTaxAmount),
        snapshotSupplierPayableShareAmount: Number(snapshot.supplierPayableShareAmount),
      });

      const refund = await tx.refundObligation.create({
        data: {
          paymentAttemptId: dispute.orderAllocation.masterOrder.paymentAttemptId,
          source: "DISPUTE",
          disputeDecisionId: decision.id,
          reasonCode: input.decisionType === "FULL_REFUND" ? "DISPUTE_FULL_REFUND" : "DISPUTE_PARTIAL_REFUND",
          productRefundAmountInclTax: productRefund!,
          shippingRefundAmount: shippingRefund!,
          amount: reversal.totalRefundAmount,
        },
      });

      const journal = await tx.journalEntry.create({
        data: {
          eventType: "DISPUTE_REFUND_OBLIGATION",
          referenceType: "refund_obligation",
          referenceId: refund.id,
          idempotencyKey: `dispute-refund:${refund.id}`,
        },
      });

      const postings: { journalEntryId: string; account: "SUPPLIER_PAYABLE" | "PLATFORM_COMMISSION_REVENUE" | "COMMISSION_TAX_PAYABLE" | "SHIPPING_LIABILITY" | "CUSTOMER_REFUND_PAYABLE"; direction: "DEBIT" | "CREDIT"; amount: number }[] = [];
      if (reversal.supplierPayableDebitAmount > 0) {
        postings.push({ journalEntryId: journal.id, account: "SUPPLIER_PAYABLE", direction: "DEBIT", amount: reversal.supplierPayableDebitAmount });
      }
      if (reversal.commissionReversalAmount > 0) {
        postings.push({ journalEntryId: journal.id, account: "PLATFORM_COMMISSION_REVENUE", direction: "DEBIT", amount: reversal.commissionReversalAmount });
      }
      if (reversal.commissionTaxReversalAmount > 0) {
        postings.push({ journalEntryId: journal.id, account: "COMMISSION_TAX_PAYABLE", direction: "DEBIT", amount: reversal.commissionTaxReversalAmount });
      }
      if (shippingRefund! > 0) {
        postings.push({ journalEntryId: journal.id, account: "SHIPPING_LIABILITY", direction: "DEBIT", amount: shippingRefund! });
      }
      postings.push({ journalEntryId: journal.id, account: "CUSTOMER_REFUND_PAYABLE", direction: "CREDIT", amount: reversal.totalRefundAmount });

      await tx.ledgerPosting.createMany({ data: postings });

      await tx.dispute.update({
        where: { id: disputeId },
        data: { status: input.decisionType === "FULL_REFUND" ? "RESOLVED_ACCEPTED" : "RESOLVED_PARTIAL" },
      });

      await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_journal_entry_balance, trg_check_refund_obligation_payment_attempt_cap, trg_check_refund_obligation_allocation_cap IMMEDIATE`);
    }

    await this.emit(tx, ctx, "DISPUTE_DECIDED", "dispute", disputeId);

    return { disputeId, decisionId: decision.id, sequenceNumber, decisionType: input.decisionType };
  }

  /**
   * Validates that a storageObjectKey corresponds to a file this
   * exact user actually uploaded (never an arbitrary caller-supplied
   * string), that it isn't already tied to a DIFFERENT dispute, and
   * claims it for this one. Content-type/size were already enforced
   * at upload time by EvidenceUploadService.
   */
  private async claimEvidenceUploadTx(tx: Prisma.TransactionClient, storageObjectKey: string, disputeId: string, userId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string; uploaded_by_user_id: string; used_in_dispute_id: string | null }[]>`
      SELECT id, uploaded_by_user_id, used_in_dispute_id FROM evidence_uploads WHERE storage_object_key = ${storageObjectKey} FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "This file was not found among your uploads");
    }
    const upload = rows[0];
    if (upload.uploaded_by_user_id !== userId) {
      throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "This file was not uploaded by you");
    }
    if (upload.used_in_dispute_id !== null && upload.used_in_dispute_id !== disputeId) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "This file is already attached to a different dispute");
    }
    await tx.evidenceUpload.update({ where: { id: upload.id }, data: { usedInDisputeId: disputeId } });
  }

  // -----------------------------------------------------------------
  // Isolated read views — each party sees only what it should. No
  // bank/VAT/Ledger internals, and neither trader nor supplier can
  // see the other's identity beyond what's already implicit in the
  // dispute itself (order allocation ownership already proves the
  // relationship exists).
  // -----------------------------------------------------------------

  async getForTrader(disputeId: string, traderCompanyId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      select: {
        id: true,
        orderAllocationId: true,
        reasonCode: true,
        description: true,
        status: true,
        supplierResponseDueAt: true,
        openedAt: true,
        orderAllocation: { select: { masterOrder: { select: { traderCompanyId: true } } } },
        evidence: { select: { id: true, storageObjectKey: true, uploadedAt: true } },
        supplierResponse: { select: { responseType: true, description: true, respondedAt: true } },
        decisions: { select: { sequenceNumber: true, decisionType: true, reasonNote: true, decidedAt: true } },
      },
    });
    if (!dispute || dispute.orderAllocation.masterOrder.traderCompanyId !== traderCompanyId) {
      throw new NotFoundException("Dispute not found");
    }
    const { orderAllocation: _oa, ...rest } = dispute;
    void _oa;
    return rest;
  }

  async getForSupplier(disputeId: string, supplierCompanyId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      select: {
        id: true,
        orderAllocationId: true,
        reasonCode: true,
        description: true,
        status: true,
        supplierResponseDueAt: true,
        openedAt: true,
        orderAllocation: { select: { masterOrder: { select: { supplierCompanyId: true } } } },
        evidence: { select: { id: true, storageObjectKey: true, uploadedAt: true } },
        supplierResponse: { select: { responseType: true, description: true, respondedAt: true } },
        decisions: { select: { sequenceNumber: true, decisionType: true, reasonNote: true, decidedAt: true } },
      },
    });
    if (!dispute || dispute.orderAllocation.masterOrder.supplierCompanyId !== supplierCompanyId) {
      throw new NotFoundException("Dispute not found");
    }
    const { orderAllocation: _oa, ...rest } = dispute;
    void _oa;
    return rest;
  }

  async getForAdmin(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        evidence: true,
        supplierResponse: true,
        decisions: { include: { refundObligation: true, replacementObligation: true } },
        orderAllocation: { select: { id: true, status: true, masterOrderId: true } },
      },
    });
    if (!dispute) throw new NotFoundException("Dispute not found");
    return dispute;
  }

  async listForAdmin(filters?: { status?: string }) {
    return this.prisma.dispute.findMany({
      where: filters?.status ? { status: filters.status as never } : undefined,
      select: { id: true, orderAllocationId: true, reasonCode: true, status: true, supplierResponseDueAt: true, openedAt: true },
      orderBy: { openedAt: "desc" },
      take: 200,
    });
  }

  private assertDescription(description: string): void {
    if (!description || description.trim().length < MIN_DESCRIPTION_LENGTH) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, `description must be at least ${MIN_DESCRIPTION_LENGTH} characters`);
    }
  }

  private async emit(tx: Prisma.TransactionClient, ctx: ActorContext, action: string, entityType: string, entityId: string): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorType: ctx.userId ? AuditActorType.USER : AuditActorType.SYSTEM,
        actorId: ctx.userId ?? null,
        companyId: ctx.companyId ?? null,
        action,
        entityType,
        entityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    await tx.outboxEvent.create({
      data: { eventType: action, payload: { entityType, entityId } as Prisma.InputJsonValue },
    });
  }
}
