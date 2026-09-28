import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { AdminInvoiceDocumentItem } from "@platform/types";
import { InternalDraftInvoiceProvider } from "./internal-draft-invoice.provider";

interface AdminActorContext {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const IDEMPOTENCY_SCOPE = "INVOICE_DRAFT";
const IDEMPOTENCY_TTL_HOURS = 24;
const MAX_RETRY = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Canonical decimal-string representation ("100.00") — matches the DB's invoice_json_decimal() format exactly. Never a float in JSON. */
function toDecimalString(n: number): string {
  return round2(n).toFixed(2);
}

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceProvider: InternalDraftInvoiceProvider
  ) {}

  /**
   * Every invoice document raised against one order.
   *
   * A CLOSED projection. The previous read was a bare `findMany`, which
   * returned `snapshotData` — the full frozen computation behind each
   * document, carrying line items, policy versions and both parties'
   * billing details. That blob is retained so a figure can be
   * re-derived years later, not so it can be shipped to a screen that
   * shows a total.
   *
   * `amount` is a `Decimal(14,2)` column serialised with `toFixed(2)`;
   * handed over raw it stringifies as `"100"` rather than `"100.00"`.
   */
  async list(masterOrderId: string): Promise<AdminInvoiceDocumentItem[]> {
    const rows = await this.prisma.invoiceDocument.findMany({
      where: { masterOrderId },
      select: {
        id: true,
        documentType: true,
        masterOrderId: true,
        relatedInvoiceDocumentId: true,
        amount: true,
        currency: true,
        internalDocumentReference: true,
        issuedAt: true,
        createdAt: true,
      },
      // Terminating in `id`: an adjustment raised in the same
      // millisecond as the document it corrects must not appear before
      // it.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      documentType: row.documentType,
      masterOrderId: row.masterOrderId,
      relatedInvoiceDocumentId: row.relatedInvoiceDocumentId,
      amount: row.amount.toFixed(2),
      currency: row.currency,
      internalDocumentReference: row.internalDocumentReference,
      issuedAt: row.issuedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async createProductDraft(masterOrderId: string, ctx: AdminActorContext, idempotencyKey: string) {
    return this.withIdempotency("PRODUCT", masterOrderId, ctx, idempotencyKey, (tx) => this.createProductDraftTx(tx, masterOrderId, ctx));
  }

  async createCommissionDraft(masterOrderId: string, ctx: AdminActorContext, idempotencyKey: string) {
    return this.withIdempotency("COMMISSION", masterOrderId, ctx, idempotencyKey, (tx) => this.createCommissionDraftTx(tx, masterOrderId, ctx));
  }

  async createAdjustment(
    relatedInvoiceDocumentId: string,
    input: { amount: number; sourceDescription: string; sourceReferenceId?: string },
    ctx: AdminActorContext,
    idempotencyKey: string
  ) {
    return this.withIdempotency("ADJUSTMENT", relatedInvoiceDocumentId, ctx, idempotencyKey, (tx) =>
      this.createAdjustmentTx(tx, relatedInvoiceDocumentId, input, ctx)
    );
  }

  private async withIdempotency<T>(
    kind: string,
    subjectId: string,
    _ctx: AdminActorContext,
    idempotencyKey: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    const requestHash = JSON.stringify({ kind, subjectId });
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
          VALUES (${IDEMPOTENCY_SCOPE}, ${idempotencyKey}, ${requestHash}, 'IN_PROGRESS', now() + interval '${Prisma.raw(String(IDEMPOTENCY_TTL_HOURS))} hours', now())
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING id
        `;

        if (claimed.length > 0) {
          const result = await work(tx);
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
        return { kind: "existing" as const, result: row.response_snapshot as T };
      });

      if (outcome.kind !== "retry") return outcome.result;
    }
    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not process the invoice draft under concurrent load");
  }

  private async createProductDraftTx(tx: Prisma.TransactionClient, masterOrderId: string, ctx: AdminActorContext) {
    const order = await tx.masterOrder.findUnique({ where: { id: masterOrderId } });
    if (!order) throw new NotFoundException("Master order not found");

    // Buyer (trader) billing identity: either the frozen snapshot on
    // MasterOrder itself, or — for legacy orders — the admin-created
    // override. Never a live re-read of TraderTaxProfile.
    let buyerTaxProfile: { isVatRegistered: boolean; vatNumber: string | null };
    let buyerBillingLegalName: string;
    if (order.traderTaxProfileSnapshot !== null) {
      buyerTaxProfile = order.traderTaxProfileSnapshot as { isVatRegistered: boolean; vatNumber: string | null };
      buyerBillingLegalName = order.traderBillingLegalNameSnapshot!;
    } else {
      const override = await tx.masterOrderBuyerBillingOverride.findUnique({ where: { masterOrderId } });
      if (!override) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This order has no buyer billing snapshot and no override — cannot create a product draft");
      }
      const snap = override.traderTaxProfileSnapshotOverride as { isVatRegistered: boolean; vatNumber: string | null; billingLegalName: string };
      buyerTaxProfile = { isVatRegistered: snap.isVatRegistered, vatNumber: snap.vatNumber };
      buyerBillingLegalName = snap.billingLegalName;
    }

    const allocations = await tx.orderAllocation.findMany({ where: { masterOrderId }, include: { financialSnapshot: true } });
    const snapshots = allocations.map((a) => a.financialSnapshot).filter((s): s is NonNullable<typeof s> => s !== null);
    if (snapshots.length === 0 || snapshots.length !== allocations.length) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "This order does not have complete financial snapshots for all allocations yet");
    }

    const subtotalExclTax = round2(snapshots.reduce((sum, s) => sum + Number(s.productAmountExclTax), 0));
    const taxAmount = round2(snapshots.reduce((sum, s) => sum + Number(s.productTaxAmount), 0));
    const totalInclTax = round2(snapshots.reduce((sum, s) => sum + Number(s.productAmountInclTax), 0));

    const snapshotData = {
      documentPurpose: "NOT_A_TAX_INVOICE",
      // WHAT WAS INVOICED, IN THE INVOICE.
      //
      // The document froze the seller, the buyer and the money and left
      // the GOODS to be found by following masterOrder -> opportunity ->
      // approval snapshot -> product: three rows an administrator can
      // remove. An invoice that cannot say what it invoiced is not an
      // invoice, and the platform was compensating by refusing to let a
      // sold product go.
      //
      // TAKEN FROM THE ORDER'S OWN SNAPSHOT, which the payment webhook
      // wrote at capture from the frozen approval record — so it is the
      // name that was approved and published, never whatever the
      // supplier renames the product to afterwards.
      line: {
        productNameAr: order.productNameArSnapshot,
        productNameEn: order.productNameEnSnapshot,
        salesUnitNameAr: order.salesUnitNameArSnapshot,
        salesUnitNameEn: order.salesUnitNameEnSnapshot,
        unitPriceInclTax: toDecimalString(Number(order.unitPriceInclTaxSnapshot)),
        quantity: order.totalQuantitySnapshot,
      },
      seller: {
        legalName: order.supplierLegalNameSnapshot,
        crNumber: order.supplierCrNumberSnapshot,
        taxProfile: order.supplierTaxProfileSnapshot,
      },
      buyer: {
        legalName: buyerBillingLegalName,
        taxProfile: buyerTaxProfile,
      },
      subtotalExclTax: toDecimalString(subtotalExclTax),
      taxAmount: toDecimalString(taxAmount),
      totalInclTax: toDecimalString(totalInclTax),
      shipping: toDecimalString(0),
      currency: "SAR",
    };

    const internalDocumentReference = this.referenceProvider.generateReference("INTERNAL_PRODUCT_DRAFT");

    let document;
    try {
      document = await tx.invoiceDocument.create({
        data: {
          documentType: "INTERNAL_PRODUCT_DRAFT",
          masterOrderId,
          amount: totalInclTax,
          internalDocumentReference,
          snapshotData,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A product draft already exists for this order");
      }
      throw err;
    }

    await this.emit(tx, ctx, "INVOICE_PRODUCT_DRAFT_CREATED", document.id);
    return document;
  }

  private async createCommissionDraftTx(tx: Prisma.TransactionClient, masterOrderId: string, ctx: AdminActorContext) {
    const order = await tx.masterOrder.findUnique({ where: { id: masterOrderId } });
    if (!order) throw new NotFoundException("Master order not found");

    const platformProfile = await tx.platformBillingProfileVersion.findFirst({ orderBy: { version: "desc" } });
    if (!platformProfile) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "No platform billing profile has been configured — cannot create a commission draft");
    }

    const commissionExclTax = Number(order.commissionAmount);
    const commissionTax = Number(order.commissionTaxAmount);
    const totalInclTax = round2(commissionExclTax + commissionTax);

    const snapshotData = {
      documentPurpose: "NOT_A_TAX_INVOICE",
      // WHAT WAS INVOICED, IN THE INVOICE.
      //
      // The document froze the seller, the buyer and the money and left
      // the GOODS to be found by following masterOrder -> opportunity ->
      // approval snapshot -> product: three rows an administrator can
      // remove. An invoice that cannot say what it invoiced is not an
      // invoice, and the platform was compensating by refusing to let a
      // sold product go.
      //
      // TAKEN FROM THE ORDER'S OWN SNAPSHOT, which the payment webhook
      // wrote at capture from the frozen approval record — so it is the
      // name that was approved and published, never whatever the
      // supplier renames the product to afterwards.
      line: {
        productNameAr: order.productNameArSnapshot,
        productNameEn: order.productNameEnSnapshot,
        salesUnitNameAr: order.salesUnitNameArSnapshot,
        salesUnitNameEn: order.salesUnitNameEnSnapshot,
        unitPriceInclTax: toDecimalString(Number(order.unitPriceInclTaxSnapshot)),
        quantity: order.totalQuantitySnapshot,
      },
      seller: {
        legalName: platformProfile.legalName,
        crNumber: platformProfile.crNumber,
        isVatRegistered: platformProfile.isVatRegistered,
        vatNumber: platformProfile.vatNumber,
        addressSnapshot: platformProfile.addressSnapshot,
      },
      buyer: {
        legalName: order.supplierLegalNameSnapshot,
        crNumber: order.supplierCrNumberSnapshot,
        taxProfile: order.supplierTaxProfileSnapshot,
      },
      commissionExclTax: toDecimalString(commissionExclTax),
      commissionTax: toDecimalString(commissionTax),
      totalInclTax: toDecimalString(totalInclTax),
      commissionTaxRate: Number(order.commissionTaxRate),
      commissionTaxRuleCode: order.commissionTaxRuleCode,
      commissionTaxRuleVersion: order.commissionTaxRuleVersion,
      platformBillingProfileVersionId: platformProfile.id,
      currency: "SAR",
    };

    const internalDocumentReference = this.referenceProvider.generateReference("INTERNAL_COMMISSION_DRAFT");

    let document;
    try {
      document = await tx.invoiceDocument.create({
        data: {
          documentType: "INTERNAL_COMMISSION_DRAFT",
          masterOrderId,
          amount: totalInclTax,
          internalDocumentReference,
          snapshotData,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A commission draft already exists for this order");
      }
      throw err;
    }

    await this.emit(tx, ctx, "INVOICE_COMMISSION_DRAFT_CREATED", document.id);
    return document;
  }

  private async createAdjustmentTx(
    tx: Prisma.TransactionClient,
    relatedInvoiceDocumentId: string,
    input: { amount: number; sourceDescription: string; sourceReferenceId?: string },
    ctx: AdminActorContext
  ) {
    const original = await tx.invoiceDocument.findUnique({ where: { id: relatedInvoiceDocumentId } });
    if (!original) throw new NotFoundException("Original invoice draft not found");
    if (original.documentType === "INTERNAL_ADJUSTMENT_DRAFT") {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Cannot create an adjustment against another adjustment");
    }
    if (input.amount <= 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Adjustment amount must be positive");
    }

    const existingAdjustments = await tx.invoiceDocument.findMany({
      where: { relatedInvoiceDocumentId, documentType: "INTERNAL_ADJUSTMENT_DRAFT" },
    });
    const existingSum = existingAdjustments.reduce((sum, a) => sum + Number(a.amount), 0);
    if (round2(existingSum + input.amount) > Number(original.amount)) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "This adjustment would exceed the original document's amount");
    }

    const snapshotData = {
      documentPurpose: "NOT_A_TAX_INVOICE",
      // AND A CREDIT NOTE CARRIES THE LINE IT IS CORRECTING.
      //
      // It has no order in scope and does not need one: an adjustment
      // exists to correct ONE document, and what that document said
      // was sold is what this one is adjusting. Reading the order
      // again could pick up a different answer if anything upstream
      // ever changed; reading the original cannot.
      line:
        (original.snapshotData as { line?: unknown } | null)?.line ?? null,
      adjustmentReason: input.sourceDescription,
      sourceReferenceId: input.sourceReferenceId ?? null,
      originalDocumentAmount: Number(original.amount),
      originalInternalDocumentReference: original.internalDocumentReference,
      currency: original.currency,
    };

    const internalDocumentReference = this.referenceProvider.generateReference("INTERNAL_ADJUSTMENT_DRAFT");

    const document = await tx.invoiceDocument.create({
      data: {
        documentType: "INTERNAL_ADJUSTMENT_DRAFT",
        masterOrderId: original.masterOrderId,
        relatedInvoiceDocumentId,
        amount: round2(input.amount),
        internalDocumentReference,
        snapshotData,
      },
    });

    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_invoice_adjustment_consistency IMMEDIATE`);

    await this.emit(tx, ctx, "INVOICE_ADJUSTMENT_DRAFT_CREATED", document.id);
    return document;
  }

  private async emit(tx: Prisma.TransactionClient, ctx: AdminActorContext, action: string, entityId: string): Promise<void> {
    await tx.auditLog.create({
      data: {
        // ADMIN, not USER. Every invoice document here is raised by an
        // administrator — the controller states there is no supplier- or
        // trader-facing route to any of this, by design.
        actorType: AuditActorType.ADMIN,
        actorId: ctx.userId,
        action,
        entityType: "invoice_document",
        entityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    await tx.outboxEvent.create({ data: { eventType: action, payload: { entityId } as Prisma.InputJsonValue } });
  }
}
