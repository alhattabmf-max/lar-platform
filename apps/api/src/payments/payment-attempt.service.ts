import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { PaymentSettingsService } from "../settings/payment-settings.service";
import { CommissionTaxPolicyService } from "../settings/commission-tax-policy.service";
import type { PaymentProvider } from "./providers/payment-provider.interface";

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const MAX_IDEMPOTENCY_RETRY = 3;
const IDEMPOTENCY_TTL_HOURS = 1;

@Injectable()
export class PaymentAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly commissionTaxPolicy: CommissionTaxPolicyService,
    @Inject("PaymentProvider") private readonly provider: PaymentProvider
  ) {}

  async startPayment(checkoutSessionId: string, idempotencyKey: string, ctx: ActorContext) {
    const scope = `PAYMENT_ATTEMPT_START:${ctx.companyId}:${checkoutSessionId}`;
    const requestHash = createHash("sha256").update(JSON.stringify({ checkoutSessionId })).digest("hex");

    for (let attempt = 0; attempt < MAX_IDEMPOTENCY_RETRY; attempt++) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
          VALUES (${scope}, ${idempotencyKey}, ${requestHash}, 'IN_PROGRESS', now() + interval '${Prisma.raw(String(IDEMPOTENCY_TTL_HOURS))} hours', now())
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING id
        `;

        if (claimed.length > 0) {
          const view = await this.createAttemptTx(tx, checkoutSessionId, ctx);
          await tx.$executeRaw`
            UPDATE idempotency_keys SET status = 'COMPLETED', response_snapshot = ${JSON.stringify(view)}::jsonb, updated_at = now()
            WHERE scope = ${scope} AND key = ${idempotencyKey}
          `;
          return { kind: "created" as const, view, attemptId: view.id };
        }

        const existing = await tx.$queryRaw<
          { status: string; request_hash: string; response_snapshot: unknown }[]
        >`SELECT status, request_hash, response_snapshot FROM idempotency_keys WHERE scope = ${scope} AND key = ${idempotencyKey} FOR UPDATE`;

        if (existing.length === 0) return { kind: "retry" as const };
        const row = existing[0];
        if (row.status !== "COMPLETED") return { kind: "retry" as const };
        if (row.request_hash !== requestHash) {
          throw new BusinessException(409, ERROR_CODES.CONFLICT, "Idempotency-Key was already used with a different request");
        }
        const snap = row.response_snapshot as { id: string; status: string; amount: number; currency: string };
        return { kind: "existing" as const, view: snap, attemptId: snap.id };
      });

      if (outcome.kind === "retry") continue;

      return this.callProviderAndFinalize(outcome.attemptId, outcome.view);
    }

    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not start payment under concurrent load — please retry");
  }

  private async createAttemptTx(tx: Prisma.TransactionClient, checkoutSessionId: string, ctx: ActorContext) {
    const sessionRows = await tx.$queryRaw<{ id: string; trader_company_id: string; status: string; lock_expires_at: Date }[]>`
      SELECT id, trader_company_id, status, lock_expires_at FROM checkout_sessions WHERE id = ${checkoutSessionId}::uuid FOR UPDATE
    `;
    if (sessionRows.length === 0) throw new NotFoundException("Checkout session not found");
    const session = sessionRows[0];
    if (session.trader_company_id !== ctx.companyId) {
      throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "This checkout session does not belong to your company");
    }
    if (session.status !== "LOCKED") {
      throw new BusinessException(409, ERROR_CODES.PAYMENT_ATTEMPT_ALREADY_ACTIVE, "This checkout session is not in a state that allows starting a payment");
    }

    const traderTaxProfile = await tx.traderTaxProfile.findUnique({ where: { companyId: session.trader_company_id } });
    if (!traderTaxProfile) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Trader tax profile is incomplete — complete it before starting payment");
    }

    await this.commissionTaxPolicy.getCurrentPolicy();

    const quote = await tx.quoteSnapshot.findUniqueOrThrow({ where: { checkoutSessionId } });
    const fullSession = await tx.checkoutSession.findUniqueOrThrow({
      where: { id: checkoutSessionId },
      include: { opportunity: { include: { company: true } } },
    });

    const supplierCompanyId = fullSession.opportunity.companyId;
    const [taxProfile, invoicingProfile, supplierCompany] = await Promise.all([
      tx.supplierTaxProfile.findUnique({ where: { companyId: supplierCompanyId } }),
      tx.supplierInvoicingProfile.findUnique({ where: { companyId: supplierCompanyId } }),
      tx.company.findUniqueOrThrow({ where: { id: supplierCompanyId } }),
    ]);
    if (!taxProfile || !invoicingProfile) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Supplier billing profile is incomplete");
    }
    if (!supplierCompany.activeBankAccountId) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Supplier has no active bank account");
    }
    const bankAccount = await tx.supplierBankAccount.findUniqueOrThrow({ where: { id: supplierCompany.activeBankAccountId } });
    if (bankAccount.verificationStatus !== "VERIFIED") {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Supplier's active bank account is not verified");
    }

    const mandatoryPolicies = await tx.policyVersion.findMany({ where: { isPublished: true, isMandatory: true } });
    let policyAcceptanceId: string | null = null;
    if (mandatoryPolicies.length > 0) {
      const acceptance = await tx.policyAcceptance.findFirst({
        where: { userId: ctx.userId, policyVersionId: { in: mandatoryPolicies.map((p) => p.id) } },
        orderBy: { acceptedAt: "desc" },
      });
      policyAcceptanceId = acceptance?.id ?? null;
    }

    const settings = await this.paymentSettings.getConfig();
    const now = new Date();
    const paymentDeadlineAt = new Date(now.getTime() + settings.paymentAttemptTimeoutMinutes * 60_000);

    const created = await tx.paymentAttempt.create({
      data: {
        checkoutSessionId,
        providerCode: this.provider.providerCode,
        idempotencyKey: "",
        amount: quote.grandTotalAmount,
        currency: quote.currency,
        policyAcceptanceId,
        acceptedByUserId: ctx.userId,
      },
    });
    await tx.paymentAttempt.update({ where: { id: created.id }, data: { idempotencyKey: created.id } });

    await tx.checkoutSession.update({
      where: { id: checkoutSessionId },
      data: { status: "PAYMENT_PENDING", paymentDeadlineAt },
    });

    return { id: created.id, status: "CREATED" as const, amount: Number(quote.grandTotalAmount), currency: quote.currency };
  }

  private async callProviderAndFinalize(attemptId: string, view: { id: string; status: string; amount: number; currency: string }) {
    const attempt = await this.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.status !== "CREATED") return view;

    const result = await this.provider.createPaymentIntent({
      amount: Number(attempt.amount),
      currency: attempt.currency,
      idempotencyKey: attempt.idempotencyKey,
      merchantReference: attempt.id,
    });

    if (result.outcome === "CREATED") {
      await this.prisma.$executeRaw`
        UPDATE payment_attempts SET status = 'PENDING', provider_reference = ${result.providerReference}, updated_at = now()
        WHERE id = ${attemptId}::uuid AND status = 'CREATED'
      `;
      return { ...view, status: "PENDING" };
    }

    if (result.outcome === "RETRYABLE_UNKNOWN") {
      return view;
    }

    await this.markAttemptFailedAndRestoreCheckout(attemptId);
    return { ...view, status: "FAILED" };
  }

  private async markAttemptFailedAndRestoreCheckout(attemptId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string; checkout_session_id: string }[]>`
        UPDATE payment_attempts SET status = 'FAILED', updated_at = now()
        WHERE id = ${attemptId}::uuid AND status IN ('CREATED', 'PENDING')
        RETURNING id, checkout_session_id
      `;
      if (claimed.length === 0) return;

      const sessionRows = await tx.$queryRaw<{ id: string; lock_expires_at: Date; status: string }[]>`
        SELECT id, lock_expires_at, status FROM checkout_sessions WHERE id = ${claimed[0].checkout_session_id}::uuid FOR UPDATE
      `;
      if (sessionRows.length === 0 || sessionRows[0].status !== "PAYMENT_PENDING") return;
      const session = sessionRows[0];

      if (session.lock_expires_at > new Date()) {
        await tx.$executeRaw`
          UPDATE checkout_sessions SET status = 'LOCKED', payment_deadline_at = NULL WHERE id = ${session.id}::uuid
        `;
      } else {
        await tx.$executeRaw`
          UPDATE checkout_sessions SET status = 'EXPIRED', lock_released_at = now(), release_reason = 'EXPIRED' WHERE id = ${session.id}::uuid
        `;
      }
    });
  }
}
