import { Injectable, Inject, UnauthorizedException } from "@nestjs/common";
import { Prisma, LedgerAccount, LedgerDirection } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { CommissionTaxPolicyService } from "../settings/commission-tax-policy.service";
import type { PaymentProvider, VerifiedWebhookPayload } from "./providers/payment-provider.interface";
import { computeOrderAllocationFinancialSnapshots } from "@platform/domain";

const MAX_RETRY = 3;
const IDEMPOTENCY_TTL_HOURS = 24;

interface WebhookOutcome {
  processingOutcome: "ORDER_CREATED" | "REFUND_REQUIRED" | "PAYMENT_FAILED" | "IGNORED_OUT_OF_ORDER" | "DUPLICATE";
  masterOrderId?: string;
  refundObligationId?: string;
}

@Injectable()
export class PaymentWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissionTaxPolicy: CommissionTaxPolicyService,
    @Inject("PaymentProvider") private readonly provider: PaymentProvider
  ) {}

  async handleWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookOutcome> {
    const parsed = this.provider.verifyAndParseWebhook(rawBody, headers);
    if (!parsed) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const scope = `PAYMENT_WEBHOOK:${parsed.providerCode}`;
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
          throw new UnauthorizedException("Webhook event id reused with a different payload");
        }
        return { kind: "existing" as const, result: row.response_snapshot as WebhookOutcome };
      });

      if (outcome.kind !== "retry") return outcome.result;
    }

    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not process webhook under concurrent load");
  }

  private async processEventTx(tx: Prisma.TransactionClient, parsed: VerifiedWebhookPayload): Promise<WebhookOutcome> {
    const preview = await tx.paymentAttempt.findUnique({
      where: { id: parsed.merchantReference },
      include: { checkoutSession: { select: { opportunityId: true } } },
    });
    if (!preview) {
      throw new BusinessException(404, ERROR_CODES.VALIDATION_FAILED, "No matching payment attempt for this webhook");
    }

    const oppRows = await tx.$queryRaw<{ id: string; status: string; target_quantity: number; funded_quantity: number }[]>`
      SELECT id, status, target_quantity, funded_quantity FROM opportunities WHERE id = ${preview.checkoutSession.opportunityId}::uuid FOR UPDATE
    `;
    const opportunity = oppRows[0];

    const attemptRows = await tx.$queryRaw<
      { id: string; status: string; checkout_session_id: string; amount: string; provider_reference: string | null; currency: string }[]
    >`SELECT id, status, checkout_session_id, amount, provider_reference, currency FROM payment_attempts WHERE id = ${parsed.merchantReference}::uuid FOR UPDATE`;
    const attempt = attemptRows[0];

    const sessionRows = await tx.$queryRaw<
      { id: string; status: string; lock_expires_at: Date; lock_released_at: Date | null; payment_deadline_at: Date | null; locked_quantity: number; trader_company_id: string }[]
    >`SELECT id, status, lock_expires_at, lock_released_at, payment_deadline_at, locked_quantity, trader_company_id FROM checkout_sessions WHERE id = ${attempt.checkout_session_id}::uuid FOR UPDATE`;
    const session = sessionRows[0];

    if (parsed.eventType === "FAILURE") {
      return this.handleFailureEvent(tx, parsed, attempt, session);
    }
    return this.handleSuccessEvent(tx, parsed, attempt, session, opportunity);
  }

  private async handleFailureEvent(
    tx: Prisma.TransactionClient,
    parsed: VerifiedWebhookPayload,
    attempt: { id: string; status: string },
    session: { id: string; lock_expires_at: Date; status: string }
  ): Promise<WebhookOutcome> {
    if (attempt.status === "SUCCEEDED") {
      await this.insertEvent(tx, parsed, attempt.id, "IGNORED_OUT_OF_ORDER");
      return { processingOutcome: "IGNORED_OUT_OF_ORDER" };
    }

    await tx.$executeRaw`UPDATE payment_attempts SET status = 'FAILED', updated_at = now() WHERE id = ${attempt.id}::uuid`;

    if (session.status === "PAYMENT_PENDING") {
      if (session.lock_expires_at > new Date()) {
        await tx.$executeRaw`UPDATE checkout_sessions SET status = 'LOCKED', payment_deadline_at = NULL WHERE id = ${session.id}::uuid`;
      } else {
        await tx.$executeRaw`
          UPDATE checkout_sessions SET status = 'EXPIRED', lock_released_at = now(), release_reason = 'EXPIRED' WHERE id = ${session.id}::uuid
        `;
      }
    }

    await this.insertEvent(tx, parsed, attempt.id, "PAYMENT_FAILED");
    return { processingOutcome: "PAYMENT_FAILED" };
  }

  private async handleSuccessEvent(
    tx: Prisma.TransactionClient,
    parsed: VerifiedWebhookPayload,
    attempt: { id: string; status: string; checkout_session_id: string; amount: string; provider_reference: string | null; currency: string },
    session: {
      id: string;
      status: string;
      lock_expires_at: Date;
      lock_released_at: Date | null;
      payment_deadline_at: Date | null;
      locked_quantity: number;
      trader_company_id: string;
    },
    opportunity: { id: string; status: string; target_quantity: number; funded_quantity: number }
  ): Promise<WebhookOutcome> {
    if (attempt.status === "SUCCEEDED") {
      await this.insertEvent(tx, parsed, attempt.id, "DUPLICATE");
      return { processingOutcome: "DUPLICATE" };
    }

    await tx.$executeRaw`
      UPDATE payment_attempts
      SET status = 'SUCCEEDED', provider_captured_at = ${parsed.providerCapturedAt}, provider_captured_amount = ${parsed.providerCapturedAmount},
          provider_fee_amount = ${parsed.providerFeeAmount ?? null}, updated_at = now()
      WHERE id = ${attempt.id}::uuid
    `;

    const capturedAmount = parsed.providerCapturedAmount ?? 0;
    const capturedAt = parsed.providerCapturedAt!;

    if (parsed.currency !== "SAR" || Math.abs(capturedAmount - Number(attempt.amount)) > 0.001) {
      return this.createRefund(tx, parsed, attempt.id, "CAPTURE_AMOUNT_MISMATCH", capturedAmount);
    }

    if (session.status === "PAID") {
      return this.createRefund(tx, parsed, attempt.id, "DUPLICATE_SUCCESSFUL_CAPTURE", capturedAmount);
    }

    let cutoff: Date | null = null;
    let reasonIfLate: "LATE_CAPTURE_AFTER_DEADLINE" | "LATE_CAPTURE_AFTER_CANCEL" | null = null;
    if (session.status === "EXPIRED") {
      cutoff = session.payment_deadline_at;
      reasonIfLate = "LATE_CAPTURE_AFTER_DEADLINE";
    } else if (session.status === "ABANDONED") {
      cutoff = session.lock_released_at;
      reasonIfLate = "LATE_CAPTURE_AFTER_CANCEL";
    }
    if (cutoff && capturedAt >= cutoff) {
      return this.createRefund(tx, parsed, attempt.id, reasonIfLate!, capturedAmount);
    }

    const fullSession = await tx.checkoutSession.findUniqueOrThrow({
      where: { id: session.id },
      include: {
        opportunity: { include: { company: true } },
        quoteSnapshot: true,
        allocations: true,
        traderCompany: true,
      },
    });
    const supplierCompany = fullSession.opportunity.company;
    if (!supplierCompany.activeBankAccountId) {
      return this.createRefund(tx, parsed, attempt.id, "BANK_ACCOUNT_NOT_VERIFIED", capturedAmount);
    }
    const bankAccount = await tx.supplierBankAccount.findUniqueOrThrow({ where: { id: supplierCompany.activeBankAccountId } });
    if (bankAccount.verificationStatus !== "VERIFIED") {
      return this.createRefund(tx, parsed, attempt.id, "BANK_ACCOUNT_NOT_VERIFIED", capturedAmount);
    }

    let commissionTaxPolicy;
    try {
      commissionTaxPolicy = await this.commissionTaxPolicy.getCurrentPolicy();
    } catch {
      return this.createRefund(tx, parsed, attempt.id, "COMMISSION_TAX_NOT_CONFIGURED", capturedAmount);
    }

    const quote = fullSession.quoteSnapshot!;
    if (fullSession.opportunity.commissionRateBasisPoints === null) {
      throw new Error(`Opportunity ${opportunity.id} reached a successful capture without a frozen commissionRateBasisPoints — data integrity violation`);
    }
    const commissionRateBasisPoints = fullSession.opportunity.commissionRateBasisPoints;
    const commissionBase = Number(fullSession.opportunity.unitPriceExclTaxAmount) * session.locked_quantity;
    const commissionAmount = round2((commissionBase * commissionRateBasisPoints) / 10000);
    const commissionTaxAmount = round2((commissionAmount * commissionTaxPolicy.ratePercent) / 100);
    const grandTotal = Number(quote.grandTotalAmount);
    const supplierPayableAmount = round2(grandTotal - commissionAmount - commissionTaxAmount);

    const taxProfile = await tx.supplierTaxProfile.findUniqueOrThrow({ where: { companyId: supplierCompany.id } });
    const invoicingProfile = await tx.supplierInvoicingProfile.findUniqueOrThrow({ where: { companyId: supplierCompany.id } });

    const traderTaxProfileRows = await tx.$queryRaw<
      { id: string; is_vat_registered: boolean; vat_number: string | null; billing_legal_name: string }[]
    >`SELECT id, is_vat_registered, vat_number, billing_legal_name FROM trader_tax_profiles WHERE company_id = ${session.trader_company_id}::uuid FOR UPDATE`;
    if (traderTaxProfileRows.length === 0) {
      return this.createRefund(tx, parsed, attempt.id, "TRADER_TAX_PROFILE_INCOMPLETE", capturedAmount);
    }
    const traderTaxProfile = traderTaxProfileRows[0];

    await tx.$executeRaw`
      UPDATE checkout_sessions SET status = 'PAID', captured_at = ${capturedAt}, release_reason = NULL,
        lock_released_at = COALESCE(lock_released_at, now())
      WHERE id = ${session.id}::uuid
    `;

    const newFunded = opportunity.funded_quantity + session.locked_quantity;
    if (opportunity.status === "ACTIVE") {
      const newStatus = newFunded >= opportunity.target_quantity ? "FUNDED" : "ACTIVE";
      await tx.opportunity.update({ where: { id: opportunity.id }, data: { fundedQuantity: newFunded, status: newStatus } });
    } else {
      await tx.opportunity.update({ where: { id: opportunity.id }, data: { fundedQuantity: newFunded } });
    }

    const attemptFull = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });

    const order = await tx.masterOrder.create({
      data: {
        checkoutSessionId: session.id,
        opportunityId: opportunity.id,
        traderCompanyId: session.trader_company_id,
        supplierCompanyId: supplierCompany.id,
        paymentAttemptId: attempt.id,
        supplierBankAccountId: bankAccount.id,
        totalAmount: grandTotal,
        commissionBase,
        commissionRateBasisPoints: commissionRateBasisPoints,
        commissionAmount,
        commissionTaxRate: commissionTaxPolicy.ratePercent,
        commissionTaxRuleCode: commissionTaxPolicy.ruleCode,
        commissionTaxRuleVersion: commissionTaxPolicy.ruleVersion,
        commissionTaxAmount,
        supplierPayableAmount,
        supplierLegalNameSnapshot: supplierCompany.legalName,
        supplierCrNumberSnapshot: supplierCompany.crNumber,
        supplierTaxProfileSnapshot: { isVatRegistered: taxProfile.isVatRegistered, vatNumber: taxProfile.vatNumber },
        supplierInvoicingProfileSnapshot: { invoicingLegalName: invoicingProfile.invoicingLegalName },
        traderTaxProfileSnapshot: { isVatRegistered: traderTaxProfile.is_vat_registered, vatNumber: traderTaxProfile.vat_number },
        traderBillingLegalNameSnapshot: traderTaxProfile.billing_legal_name,
        policyAcceptanceId: attemptFull.policyAcceptanceId,
        acceptedByUserId: attemptFull.acceptedByUserId,
        paidAt: capturedAt,
      },
    });

    for (const alloc of fullSession.allocations) {
      const preparationDueAt = new Date(capturedAt.getTime() + fullSession.opportunity.expectedPreparationDays * 24 * 3600_000);
      await tx.orderAllocation.create({
        data: {
          masterOrderId: order.id,
          checkoutLocationAllocationId: alloc.id,
          expectedPreparationDays: fullSession.opportunity.expectedPreparationDays,
          preparationDueAt,
        },
      });
    }

    // Phase 7E — every future order gets its per-allocation financial
    // snapshot computed and frozen right here, within this same
    // transaction, never re-derived later.
    {
      const totalQuantity = fullSession.allocations.reduce((sum: number, a: { quantity: number }) => sum + a.quantity, 0);
      const computed = computeOrderAllocationFinancialSnapshots({
        masterOrderTotalQuantity: totalQuantity,
        branches: fullSession.allocations.map((a: { id: string; createdAt: Date; quantity: number; shippingFeeAmount: Prisma.Decimal }) => ({
          checkoutLocationAllocationId: a.id,
          createdAt: a.createdAt,
          quantity: a.quantity,
          unitPriceExclTaxAmount: Number(quote.unitPriceExclTaxAmount),
          unitTaxAmount: Number(quote.unitTaxAmount),
          shippingFeeAmount: Number(a.shippingFeeAmount),
        })),
        masterOrderCommissionAmount: commissionAmount,
        masterOrderCommissionTaxAmount: commissionTaxAmount,
      });

      const createdAllocations = await tx.orderAllocation.findMany({ where: { masterOrderId: order.id } });
      for (const c of computed) {
        const allocationRow = createdAllocations.find((a) => a.checkoutLocationAllocationId === c.checkoutLocationAllocationId)!;
        await tx.orderAllocationFinancialSnapshot.create({
          data: {
            orderAllocationId: allocationRow.id,
            productAmountExclTax: c.productAmountExclTax,
            productTaxAmount: c.productTaxAmount,
            productAmountInclTax: c.productAmountInclTax,
            allocationShareBasisPoints: c.allocationShareBasisPoints,
            commissionShareAmount: c.commissionShareAmount,
            commissionShareTaxAmount: c.commissionShareTaxAmount,
            supplierPayableShareAmount: c.supplierPayableShareAmount,
            shippingFeeAmount: c.shippingFeeAmount,
            productAmountRoundingRemainder: c.productAmountRoundingRemainder,
            commissionShareRoundingRemainder: c.commissionShareRoundingRemainder,
            commissionShareTaxRoundingRemainder: c.commissionShareTaxRoundingRemainder,
            supplierPayableShareRoundingRemainder: c.supplierPayableShareRoundingRemainder,
          },
        });
      }
      await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_financial_snapshot_sums_match_source IMMEDIATE`);
    }

    await tx.$executeRaw`
      UPDATE payment_attempts SET status = 'SUPERSEDED', updated_at = now()
      WHERE checkout_session_id = ${session.id}::uuid AND status IN ('CREATED', 'PENDING') AND id != ${attempt.id}::uuid
    `;

    await this.postOrderLedger(tx, order.id, grandTotal, commissionAmount, commissionTaxAmount, parsed.providerFeeAmount);

    await this.insertEvent(tx, parsed, attempt.id, "ORDER_CREATED");
    return { processingOutcome: "ORDER_CREATED", masterOrderId: order.id };
  }

  private async createRefund(
    tx: Prisma.TransactionClient,
    parsed: VerifiedWebhookPayload,
    paymentAttemptId: string,
    reasonCode:
      | "CAPTURE_AMOUNT_MISMATCH"
      | "DUPLICATE_SUCCESSFUL_CAPTURE"
      | "LATE_CAPTURE_AFTER_DEADLINE"
      | "LATE_CAPTURE_AFTER_CANCEL"
      | "BANK_ACCOUNT_NOT_VERIFIED"
      | "COMMISSION_TAX_NOT_CONFIGURED"
      | "TRADER_TAX_PROFILE_INCOMPLETE",
    capturedAmount: number
  ): Promise<WebhookOutcome> {
    const refund = await tx.refundObligation.create({
      data: { paymentAttemptId, source: "PAYMENT_EXCEPTION", reasonCode, amount: capturedAmount, currency: parsed.currency },
    });

    const journal = await tx.journalEntry.create({
      data: {
        eventType: "PAYMENT_REFUND_OBLIGATION",
        referenceType: "refund_obligation",
        referenceId: refund.id,
        idempotencyKey: `refund:${refund.id}`,
      },
    });
    await tx.ledgerPosting.createMany({
      data: [
        { journalEntryId: journal.id, account: "CASH_CLEARING", direction: "DEBIT", amount: capturedAmount },
        { journalEntryId: journal.id, account: "CUSTOMER_REFUND_PAYABLE", direction: "CREDIT", amount: capturedAmount },
      ],
    });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE`);

    await this.insertEvent(tx, parsed, paymentAttemptId, "REFUND_REQUIRED");
    return { processingOutcome: "REFUND_REQUIRED", refundObligationId: refund.id };
  }

  private async postOrderLedger(
    tx: Prisma.TransactionClient,
    orderId: string,
    grandTotal: number,
    commissionAmount: number,
    commissionTaxAmount: number,
    providerFeeAmount: number | undefined
  ): Promise<void> {
    const supplierPayable = round2(grandTotal - commissionAmount - commissionTaxAmount);
    const journal = await tx.journalEntry.create({
      data: { eventType: "ORDER_CREATED", referenceType: "master_order", referenceId: orderId, idempotencyKey: `order:${orderId}` },
    });
    const postings: { journalEntryId: string; account: LedgerAccount; direction: LedgerDirection; amount: number }[] = [
      { journalEntryId: journal.id, account: "CASH_CLEARING", direction: "DEBIT", amount: grandTotal },
      { journalEntryId: journal.id, account: "SUPPLIER_PAYABLE", direction: "CREDIT", amount: supplierPayable },
      { journalEntryId: journal.id, account: "PLATFORM_COMMISSION_REVENUE", direction: "CREDIT", amount: commissionAmount },
      { journalEntryId: journal.id, account: "COMMISSION_TAX_PAYABLE", direction: "CREDIT", amount: commissionTaxAmount },
    ];
    if (providerFeeAmount && providerFeeAmount > 0) {
      postings.push({ journalEntryId: journal.id, account: "PAYMENT_PROCESSING_FEE_EXPENSE", direction: "DEBIT", amount: providerFeeAmount });
      postings.push({ journalEntryId: journal.id, account: "CASH_CLEARING", direction: "CREDIT", amount: providerFeeAmount });
    }
    await tx.ledgerPosting.createMany({ data: postings });
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE`);
  }

  private async insertEvent(
    tx: Prisma.TransactionClient,
    parsed: VerifiedWebhookPayload,
    paymentAttemptId: string,
    outcome: WebhookOutcome["processingOutcome"]
  ): Promise<void> {
    await tx.providerPaymentEvent.create({
      data: {
        provider: parsed.providerCode,
        providerEventId: parsed.providerEventId,
        paymentAttemptId,
        eventType: parsed.eventType,
        providerCapturedAt: parsed.providerCapturedAt ?? null,
        providerCapturedAmount: parsed.providerCapturedAmount ?? null,
        providerFeeAmount: parsed.providerFeeAmount ?? null,
        processingOutcome: outcome,
        payloadHash: parsed.payloadHash,
        payloadMetadataRedacted: { providerReference: parsed.providerReference },
      },
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
