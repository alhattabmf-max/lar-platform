import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { PaymentAttemptView } from "@platform/types";
import { PaymentSettingsService } from "../settings/payment-settings.service";
import { CommissionTaxPolicyService } from "../settings/commission-tax-policy.service";
import { newestPolicyVersionPerDocument } from "../policies/policy-version-selection";
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

  /**
   * Starts one payment attempt for a checkout session.
   *
   * Returns the closed `PaymentAttemptView`: id, status, amount,
   * currency. Not the row — that carries the provider code, the
   * provider reference, the internal idempotency key, the policy
   * acceptance id and the accepting user, none of which a trader needs
   * and all of which describe how the integration works.
   */
  async startPayment(
    checkoutSessionId: string,
    idempotencyKey: string,
    ctx: ActorContext
  ): Promise<PaymentAttemptView> {
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
        // Replayed verbatim from the stored snapshot, which was
        // written in this same shape — so a retry of one operation
        // answers byte-identically to its first response.
        const snap = row.response_snapshot as PaymentAttemptView;
        return { kind: "existing" as const, view: snap, attemptId: snap.id };
      });

      if (outcome.kind === "retry") continue;

      return this.callProviderAndFinalize(outcome.attemptId, outcome.view);
    }

    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not start payment under concurrent load — please retry");
  }

  private async createAttemptTx(
    tx: Prisma.TransactionClient,
    checkoutSessionId: string,
    ctx: ActorContext
  ): Promise<PaymentAttemptView> {
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

    /**
     * AND THE LOCK MUST STILL BE ALIVE.
     *
     * `status = 'LOCKED'` ALONE WAS NOT ENOUGH, and that was the hole.
     * A basket becomes EXPIRED by a sweep that runs every minute and by
     * a lazy cleanup that only fires for the same trader on the same
     * offer — so between the instant `lock_expires_at` passes and the
     * instant something notices, the row still SAYS `LOCKED`. Claiming
     * it here moved it to `PAYMENT_PENDING` with a fresh deadline: a
     * dead basket brought back to life, holding stock that had already
     * gone back on the shelf.
     *
     * WHAT IT COST, on the money path. The quantity that basket holds
     * is no longer subtracted from availability, so another buyer can
     * have taken it — and a supplier lowering a DIRECT listing's stock
     * can have taken it too. Let the revived basket then pay, and the
     * webhook's `funded += locked` lands above `target_quantity`, where
     * `opportunities_funded_within_target` refuses it INSIDE the
     * capture's own transaction: money taken, no order written, and a
     * provider redelivering the same event for ever.
     *
     * THE SAME RULE FOR BOTH SALE MODES, because a lock means one thing
     * in both: units held for one buyer, for a bounded time. Nothing
     * here reads `sale_mode`, and nothing should.
     *
     * NOT REVIVED, NOT EXTENDED, AND NOT SILENTLY EXPIRED HERE EITHER.
     * The buyer opens a new checkout and is told what is actually
     * available now — which may be less, and that is the truth rather
     * than a promise of stock that is gone. Marking the row EXPIRED is
     * left to the sweep that owns that transition, so this path has one
     * job and one failure mode.
     */
    if (session.lock_expires_at <= new Date()) {
      throw new BusinessException(
        409,
        ERROR_CODES.CHECKOUT_LOCK_EXPIRED,
        "This checkout has expired — start a new one to see the quantity still available"
      );
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

    // The same set the checkout guard checks, so the acceptance this
    // attempt records is one of the versions actually in force rather
    // than whichever superseded row happened to be accepted last.
    const mandatoryPolicies = newestPolicyVersionPerDocument(
      await tx.policyVersion.findMany({ where: { isPublished: true, isMandatory: true } })
    );
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

    // The amount is the frozen quote's grand total as a fixed-scale
    // decimal STRING — byte-identical to what
    // `CheckoutSessionView.grandTotalAmount` carries for this session.
    // `Number()` here would produce a figure that prints the same and
    // compares unequal, so the checkout screen and the payment screen
    // could show two different totals for one purchase.
    return {
      id: created.id,
      status: "CREATED",
      amount: quote.grandTotalAmount.toFixed(2),
      currency: quote.currency,
    };
  }

  private async callProviderAndFinalize(
    attemptId: string,
    view: PaymentAttemptView
  ): Promise<PaymentAttemptView> {
    const attempt = await this.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.status !== "CREATED") return view;

    // The provider's SDK contract takes a number. This is the ONE
    // place a money value becomes one, and it is an outbound call
    // argument rather than a serialized response field: nothing here
    // reaches a client, and the figure the trader sees comes from the
    // decimal string above.
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
      return { ...view, status: "PENDING" as const };
    }

    if (result.outcome === "RETRYABLE_UNKNOWN") {
      return view;
    }

    await this.markAttemptFailedAndRestoreCheckout(attemptId);
    return { ...view, status: "FAILED" as const };
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
