import type { Prisma, RefundObligationReasonCode } from "@prisma/client";

/**
 * GIVE EVERY BUYER ON THIS OFFER BACK EVERYTHING THEY PAID.
 *
 * «في حالة لم يكتمل الهدف يتم الاسترداد تلقائي» — and, for the admin's
 * own button, «الإدارة توقف العرض ويكون عندها زر استرداد الأموال، عند
 * الضغط يكون مثل أن فرصة انتهت ولم تكتمل».
 *
 * ONE PATH FOR THE MONEY, TWO TRIGGERS. The clock reaches it when an
 * offer's window closes without filling; an administrator reaches it by
 * pressing the button before that. Written twice, the two would drift —
 * and a buyer's refund would depend on who ended the offer.
 *
 * IN FULL, INCLUDING SHIPPING. «الشحن أصلاً مربوط كل مشتري برسوم شحن
 * معينة على حسب مدينته ومنطقته», and not one of those fees was ever
 * spent because nothing was ever shipped. Keeping them would be charging
 * for a carriage that did not happen. The owner's fault-based rule — the
 * buyer bears shipping when the fault is his — governs goods that WERE
 * shipped and came back; there a carrier really was paid.
 *
 * RAISED AGAINST `payment_attempts.amount`, which is what the buyer
 * actually paid. Recomputing goods and shipping here would be a second
 * arithmetic that could disagree with the first.
 *
 * ONE OBLIGATION PER PAYMENT, never per allocation: a refund is a
 * reversal of a capture, and the capture is the only thing the provider
 * can reverse.
 *
 * IDEMPOTENT IN THE QUERY ITSELF. A payment that already has an
 * obligation is excluded by the SELECT, so a second call — an
 * administrator pressing twice, or a tick overlapping a press — writes
 * nothing rather than refunding the same money again.
 *
 * NO COMMISSION IS TOUCHED. It is computed per order at capture, on that
 * order's own paid quantity; an offer that never delivered produced no
 * commission to reverse.
 */
export async function refundOfferPaymentsTx(
  tx: Prisma.TransactionClient,
  opportunityId: string,
  reasonCode: RefundObligationReasonCode
): Promise<number> {
  const paid = await tx.$queryRaw<
    { payment_attempt_id: string; amount: string; currency: string }[]
  >`
    SELECT pa.id AS payment_attempt_id, pa.amount, pa.currency
    FROM master_orders m
    JOIN payment_attempts pa ON pa.id = m.payment_attempt_id
    WHERE m.opportunity_id = ${opportunityId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM refund_obligations r WHERE r.payment_attempt_id = pa.id
      )
  `;

  for (const payment of paid) {
    await tx.refundObligation.create({
      data: {
        paymentAttemptId: payment.payment_attempt_id,
        source: "OPPORTUNITY_UNFUNDED",
        reasonCode,
        amount: payment.amount,
        currency: payment.currency,
      },
    });
  }

  return paid.length;
}
