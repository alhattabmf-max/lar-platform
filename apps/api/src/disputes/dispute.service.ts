import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import {
  computeDisputeRefundReversalExact,
  isPositiveExact,
  isWithinExact,
  type ExactMoney,
} from "@platform/domain";
import { PrismaService } from "../database/prisma.service";
import { NotificationEventsService } from "../notifications/notification-events.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES, MAX_TRADER_PAGE_SIZE } from "@platform/types";
import type {
  AdminDisputeDetail,
  AdminDisputeItem,
  Paginated,
  SupplierDisputeDetailView,
  SupplierDisputeSummary,
} from "@platform/types";
import {
  SUPPLIER_DISPUTE_SELECT,
  supplierDisputeListWhere,
  supplierDisputeWhere,
  supplierEvidenceQuery,
  toSupplierDisputeDetailView,
  toSupplierDisputeSummary,
  type SupplierEvidenceRow,
} from "./supplier-dispute.view";
import type { TraderDisputeDetailView } from "@platform/types";
import {
  TRADER_DISPUTE_SELECT,
  toTraderDisputeDetailView,
  traderDisputeWhere,
  traderEvidenceQuery,
  type TraderEvidenceRow,
} from "./trader-dispute.view";

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
  /**
   * Canonical two-place decimal STRINGS, not numbers.
   *
   * They were `number`, and the controller reached them by calling
   * `Number(dto.productRefundAmountInclTax)` on a value the DTO had
   * already validated as an exact decimal string. That conversion put an
   * IEEE-754 double in the middle of the one decision that determines how
   * much money leaves the platform. The digits that arrive are now the
   * digits that are compared, computed with, and stored.
   */
  productRefundAmountInclTax?: ExactMoney;
  shippingRefundAmount?: ExactMoney;
  replacementQuantity?: number;
  reasonNote: string;
}

const MIN_DESCRIPTION_LENGTH = 5;

const HTTP_IDEMPOTENCY_TTL_HOURS = 24;
const HTTP_MAX_RETRY = 3;

/**
 * The admin queue's page bounds.
 *
 * Capped at 100 like every other admin list: an uncapped page size is a
 * way to ask the database for the whole table.
 */
const DEFAULT_ADMIN_DISPUTE_PAGE_SIZE = 25;
const MAX_ADMIN_DISPUTE_PAGE_SIZE = 100;

@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationEventsService
  ) {}

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
      await this.notifications.disputeOpened(tx, dispute.id);

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
      await this.notifications.disputeSupplierResponded(tx, disputeId);

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

    // ------------------------------------------------------------------
    // MONEY, EXACT.
    //
    // Every amount below is a canonical two-place decimal STRING from the
    // moment it leaves the request body to the moment Prisma writes it.
    // There is no `Number`, no `parseFloat` and no `toNumber` on this
    // path, and `dispute-money.spec.ts` asserts that by reading the
    // source rather than trusting the reviewer.
    //
    // The frozen snapshot's own columns are `Prisma.Decimal`, so they are
    // rendered with `toFixed(2)` — the same producer every money surface
    // in this system uses — rather than converted.
    // ------------------------------------------------------------------
    const snapshotProduct = snapshot.productAmountInclTax.toFixed(2);
    const snapshotShipping = snapshot.shippingFeeAmount.toFixed(2);

    let productRefund: string | null = null;
    let shippingRefund: string | null = null;

    if (input.decisionType === "FULL_REFUND") {
      // A full refund IS the snapshot, digit for digit. Recomputing it
      // would be a second source of truth for a figure already frozen.
      productRefund = snapshotProduct;
      shippingRefund = snapshotShipping;
    } else if (input.decisionType === "PARTIAL_REFUND") {
      // `== null` rather than `=== undefined`: it catches both, so a
      // null that ever gets past the DTO stops here as a 400 instead of
      // reaching the Decimal parser and surfacing as a 500.
      if (input.productRefundAmountInclTax == null || input.shippingRefundAmount == null) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "productRefundAmountInclTax and shippingRefundAmount are required for a partial refund");
      }

      // The DTO already refused a negative, a third decimal place,
      // scientific notation, NaN, Infinity and anything too large for
      // the column. What remains is the bound against the FROZEN
      // snapshot, compared as Decimals — `Number(a) > Number(b)` here
      // would be a float re-entering the one comparison that decides
      // how much money leaves the platform.
      if (!isWithinExact(input.productRefundAmountInclTax, snapshotProduct)) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "productRefundAmountInclTax is out of bounds");
      }
      if (!isWithinExact(input.shippingRefundAmount, snapshotShipping)) {
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
        // Constructed from the ORIGINAL string, so the digits stored are
        // the digits that arrived.
        productRefundAmountInclTax: productRefund === null ? null : new Prisma.Decimal(productRefund),
        shippingRefundAmount: shippingRefund === null ? null : new Prisma.Decimal(shippingRefund),
        reasonNote: input.reasonNote.trim(),
        decidedByAdminUserId: ctx.userId!,
      },
    });

    if (input.decisionType === "REJECTED") {
      await tx.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED_REJECTED" } });
    } else if (input.decisionType === "REPLACEMENT") {
      const replacementObligation = await tx.replacementObligation.create({
        data: {
          disputeDecisionId: decision.id,
          originalOrderAllocationId: dispute.orderAllocationId,
          replacementQuantity: input.replacementQuantity!,
        },
      });
      await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_replacement_quantity_within_original IMMEDIATE`);
      await this.notifications.replacementRequired(tx, {
        replacementObligationId: replacementObligation.id,
        disputeId,
      });
      await tx.dispute.update({ where: { id: disputeId }, data: { status: "AWAITING_REPLACEMENT" } });
    } else {
      // FULL_REFUND / PARTIAL_REFUND
      //
      // The reversal balances BY CONSTRUCTION: the supplier debit is
      // derived as `productRefund − commissionReversal −
      // commissionTaxReversal`, so those two cancel out of the debit
      // total and the entry equals `productRefund + shippingRefund`
      // exactly, for every input rather than for the ones anybody tried.
      const reversal = computeDisputeRefundReversalExact({
        productRefundAmountInclTax: productRefund!,
        shippingRefundAmount: shippingRefund!,
        snapshotProductAmountInclTax: snapshotProduct,
        snapshotCommissionShareAmount: snapshot.commissionShareAmount.toFixed(2),
        snapshotCommissionShareTaxAmount: snapshot.commissionShareTaxAmount.toFixed(2),
      });

      const refund = await tx.refundObligation.create({
        data: {
          paymentAttemptId: dispute.orderAllocation.masterOrder.paymentAttemptId,
          source: "DISPUTE",
          disputeDecisionId: decision.id,
          reasonCode: input.decisionType === "FULL_REFUND" ? "DISPUTE_FULL_REFUND" : "DISPUTE_PARTIAL_REFUND",
          productRefundAmountInclTax: new Prisma.Decimal(productRefund!),
          shippingRefundAmount: new Prisma.Decimal(shippingRefund!),
          amount: new Prisma.Decimal(reversal.totalRefundAmount),
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

      // A zero-amount posting is omitted rather than written: the ledger
      // records movements, and a debit of nothing is not one. The test
      // for the zero case asserts the entry still balances without it.
      const postings: {
        journalEntryId: string;
        account: "SUPPLIER_PAYABLE" | "PLATFORM_COMMISSION_REVENUE" | "COMMISSION_TAX_PAYABLE" | "SHIPPING_LIABILITY" | "CUSTOMER_REFUND_PAYABLE";
        direction: "DEBIT" | "CREDIT";
        amount: Prisma.Decimal;
      }[] = [];

      if (isPositiveExact(reversal.supplierPayableDebitAmount)) {
        postings.push({ journalEntryId: journal.id, account: "SUPPLIER_PAYABLE", direction: "DEBIT", amount: new Prisma.Decimal(reversal.supplierPayableDebitAmount) });
      }
      if (isPositiveExact(reversal.commissionReversalAmount)) {
        postings.push({ journalEntryId: journal.id, account: "PLATFORM_COMMISSION_REVENUE", direction: "DEBIT", amount: new Prisma.Decimal(reversal.commissionReversalAmount) });
      }
      if (isPositiveExact(reversal.commissionTaxReversalAmount)) {
        postings.push({ journalEntryId: journal.id, account: "COMMISSION_TAX_PAYABLE", direction: "DEBIT", amount: new Prisma.Decimal(reversal.commissionTaxReversalAmount) });
      }
      if (isPositiveExact(shippingRefund!)) {
        postings.push({ journalEntryId: journal.id, account: "SHIPPING_LIABILITY", direction: "DEBIT", amount: new Prisma.Decimal(shippingRefund!) });
      }
      postings.push({ journalEntryId: journal.id, account: "CUSTOMER_REFUND_PAYABLE", direction: "CREDIT", amount: new Prisma.Decimal(reversal.totalRefundAmount) });

      await tx.ledgerPosting.createMany({ data: postings });

      await tx.dispute.update({
        where: { id: disputeId },
        data: { status: input.decisionType === "FULL_REFUND" ? "RESOLVED_ACCEPTED" : "RESOLVED_PARTIAL" },
      });

      await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_journal_entry_balance, trg_check_refund_obligation_payment_attempt_cap, trg_check_refund_obligation_allocation_cap IMMEDIATE`);
    }

    await this.emit(tx, ctx, "DISPUTE_DECIDED", "dispute", disputeId);
    await this.notifications.disputeDecided(tx, disputeId);

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

  /**
   * One dispute, as the trader may see it.
   *
   * Ownership is IN THE QUERY, so an unknown id and another company's
   * dispute produce the identical 404 and neither can be distinguished
   * by probing.
   *
   * Evidence is read separately and filtered by COMPANY in the
   * database — the supplier's attachments are never fetched, not
   * fetched and discarded. See `traderEvidenceQuery` for why that
   * needs raw SQL.
   */
  async getForTrader(
    disputeId: string,
    traderCompanyId: string
  ): Promise<TraderDisputeDetailView> {
    const dispute = await this.prisma.dispute.findFirst({
      where: traderDisputeWhere(disputeId, traderCompanyId),
      select: TRADER_DISPUTE_SELECT,
    });
    if (!dispute) throw new NotFoundException("Dispute not found");

    const evidence = await this.prisma.$queryRaw<TraderEvidenceRow[]>(
      traderEvidenceQuery(disputeId, traderCompanyId)
    );

    return toTraderDisputeDetailView(dispute, evidence);
  }

  /**
   * One dispute, as the supplier may see it.
   *
   * Ownership is IN THE QUERY, so an unknown id and another supplier's
   * dispute produce the identical 404 and neither can be distinguished by
   * probing.
   *
   * Evidence is read separately and filtered by COMPANY in the database — the
   * trader's attachments are never fetched, not fetched and discarded. The
   * administrator's `reasonNote` and every internal id are absent from the
   * select entirely.
   */
  async getForSupplier(
    disputeId: string,
    supplierCompanyId: string
  ): Promise<SupplierDisputeDetailView> {
    const dispute = await this.prisma.dispute.findFirst({
      where: supplierDisputeWhere(disputeId, supplierCompanyId),
      select: SUPPLIER_DISPUTE_SELECT,
    });
    if (!dispute) throw new NotFoundException("Dispute not found");

    const evidence = await this.prisma.$queryRaw<SupplierEvidenceRow[]>(
      supplierEvidenceQuery(disputeId, supplierCompanyId)
    );

    return toSupplierDisputeDetailView(dispute, evidence);
  }

  /**
   * Every dispute raised against this supplier.
   *
   * Ordered with the ones still awaiting THEIR response first — that is the
   * only thing on the list they can act on — then newest, terminating in the
   * primary key so a tie cannot serve one row twice across a page boundary.
   */
  async listForSupplier(
    supplierCompanyId: string,
    query: { page?: number; pageSize?: number }
  ): Promise<Paginated<SupplierDisputeSummary>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_TRADER_PAGE_SIZE, Math.max(1, query.pageSize ?? 20));

    const where = supplierDisputeListWhere(supplierCompanyId);

    const [rows, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        select: {
          id: true,
          orderAllocationId: true,
          status: true,
          reasonCode: true,
          openedAt: true,
          supplierResponseDueAt: true,
          orderAllocation: { select: { masterOrderId: true } },
        },
        orderBy: [{ openedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return { items: rows.map(toSupplierDisputeSummary), page, pageSize, total };
  }

  /**
   * One dispute, for an operator.
   *
   * A CLOSED projection. Until this replaced it, the read was
   * `include: { evidence: true, ... }`, which shipped
   * `DisputeEvidence.storageObjectKey` — a direct address in the object
   * store — to the browser, along with whole `RefundObligation` and
   * `ReplacementObligation` rows for every decision. Evidence is now
   * metadata plus an id; the file itself is fetched through its own
   * authorised endpoint, and the obligations are two ids the operator
   * can follow.
   *
   * The two refund figures on a decision are `Decimal(12,2)` columns
   * and are serialised with `toFixed(2)`, not handed over raw: a
   * `Decimal` stringifies as `"100"` rather than `"100.00"`, which is
   * not the money contract this system reconciles against.
   */
  async getForAdmin(disputeId: string): Promise<AdminDisputeDetail> {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      select: {
        id: true,
        orderAllocationId: true,
        reasonCode: true,
        status: true,
        description: true,
        supplierResponseDueAt: true,
        openedAt: true,
        orderAllocation: {
          select: {
            masterOrderId: true,
            masterOrder: { select: { paymentAttempt: { select: { currency: true } } } },
          },
        },
        evidence: {
          select: { id: true, uploadedAt: true },
          orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
        },
        supplierResponse: {
          select: { responseType: true, description: true, respondedAt: true },
        },
        decisions: {
          select: {
            id: true,
            sequenceNumber: true,
            decisionType: true,
            productRefundAmountInclTax: true,
            shippingRefundAmount: true,
            reasonNote: true,
            decidedAt: true,
            refundObligation: { select: { id: true } },
            // THE STATUS TOO, not only the id. The admin screen offers
            // two actions on a replacement — confirm delivered, and
            // record it as failed — and each is accepted from a
            // different set of states. With only an id the screen must
            // draw both and let the server refuse one, which is exactly
            // the doomed button this platform refuses to draw.
            replacementObligation: { select: { id: true, status: true } },
          },
          orderBy: [{ sequenceNumber: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!dispute) throw new NotFoundException("Dispute not found");

    return {
      id: dispute.id,
      orderAllocationId: dispute.orderAllocationId,
      masterOrderId: dispute.orderAllocation.masterOrderId,
      reasonCode: dispute.reasonCode,
      status: dispute.status,
      description: dispute.description,
      currency: dispute.orderAllocation.masterOrder.paymentAttempt.currency,
      supplierResponseDueAt: dispute.supplierResponseDueAt.toISOString(),
      openedAt: dispute.openedAt.toISOString(),
      evidence: dispute.evidence.map((item) => ({
        id: item.id,
        uploadedAt: item.uploadedAt.toISOString(),
      })),
      supplierResponse: dispute.supplierResponse
        ? {
            responseType: dispute.supplierResponse.responseType,
            description: dispute.supplierResponse.description,
            respondedAt: dispute.supplierResponse.respondedAt.toISOString(),
          }
        : null,
      decisions: dispute.decisions.map((decision) => ({
        id: decision.id,
        sequenceNumber: decision.sequenceNumber,
        decisionType: decision.decisionType,
        // null means the decision awarded nothing under that head,
        // which is not the same as zero and is not rendered as "0.00".
        productRefundAmountInclTax:
          decision.productRefundAmountInclTax === null
            ? null
            : decision.productRefundAmountInclTax.toFixed(2),
        shippingRefundAmount:
          decision.shippingRefundAmount === null ? null : decision.shippingRefundAmount.toFixed(2),
        reasonNote: decision.reasonNote,
        decidedAt: decision.decidedAt.toISOString(),
        refundObligationId: decision.refundObligation?.id ?? null,
        replacementObligationId: decision.replacementObligation?.id ?? null,
        replacementObligationStatus:
          decision.replacementObligation?.status ?? null,
      })),
    };
  }

  /**
   * The operator's queue.
   *
   * Paginated rather than `take: 200`. A hard take silently hides
   * everything past the two-hundredth open dispute, and hiding a case
   * from the only screen that can decide it is worse than showing a
   * second page.
   *
   * `description` is not selected: a queue is scanned, and free text
   * written by a counterparty does not belong in a scannable column.
   */
  async listForAdmin(
    filters: { status?: string; page?: number; pageSize?: number } = {}
  ): Promise<Paginated<AdminDisputeItem>> {
    const page = Math.max(1, Math.trunc(filters.page ?? 1));
    const pageSize = Math.min(
      MAX_ADMIN_DISPUTE_PAGE_SIZE,
      Math.max(1, Math.trunc(filters.pageSize ?? DEFAULT_ADMIN_DISPUTE_PAGE_SIZE))
    );

    const where: Prisma.DisputeWhereInput = filters.status
      ? { status: filters.status as never }
      : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where,
        select: {
          id: true,
          orderAllocationId: true,
          reasonCode: true,
          status: true,
          supplierResponseDueAt: true,
          openedAt: true,
          orderAllocation: { select: { masterOrderId: true } },
        },
        // Terminating in `id` so two disputes opened in the same
        // millisecond cannot swap places between pages and hide one of
        // themselves.
        orderBy: [{ openedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        orderAllocationId: row.orderAllocationId,
        masterOrderId: row.orderAllocation.masterOrderId,
        reasonCode: row.reasonCode,
        status: row.status,
        supplierResponseDueAt: row.supplierResponseDueAt.toISOString(),
        openedAt: row.openedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
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
