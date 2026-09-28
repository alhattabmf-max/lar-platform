import type { Prisma } from "@prisma/client";

/**
 * THE OFFER CLOSED: every share it holds starts its clock, together.
 *
 * «إذا اكتمل الهدف يتم إرسال الطلبات للمورد… ويبدأ التجهيز من بداية
 *  إقفال العرض.»
 *
 * TWO WAYS AN OFFER CLOSES, ONE WAY IT RELEASES. It fills on its own —
 * the payment webhook sees the target reached — or the supplier accepts
 * what it reached inside his 24-hour window. Both must date the work
 * identically, so both call this. Written twice, the two would drift,
 * and a buyer's deadline would depend on which door the offer left by.
 *
 * A PLAIN FUNCTION OVER `tx`, in the same shape as
 * `releaseActiveLocksForOpportunityTx`: each caller already runs its own
 * atomic transaction for the offer's own status change, and this has to
 * execute inside THAT transaction — never a separate one, or an offer
 * could be marked closed while its shares stayed waiting.
 *
 * ONE MOMENT FOR ALL OF THEM. A buyer who paid on day one and one who
 * paid on day three are owed the same preparation window, because the
 * supplier could not lawfully begin either until now. Dating them from
 * their own payments would hand the first buyer a supplier who was
 * already late before the work was permitted.
 *
 * EACH KEEPS THE DAYS ITS OWN OFFER PROMISED — `expectedPreparationDays`
 * was frozen on the row when that buyer paid, and is read back from the
 * row rather than from the opportunity, which may have been extended or
 * edited since.
 *
 * ROW BY ROW, NOT ONE SWEEPING UPDATE. The database refuses any
 * transition it has not been taught, and the rule it was taught reads
 * one row's old state and new state together — see the migration
 * `fulfilment_waits_for_funding`. A bulk `updateMany` cannot express
 * "set this row's date from its own frozen days".
 */
export async function releaseFundedAllocationsTx(
  tx: Prisma.TransactionClient,
  opportunityId: string,
  closedAt: Date
): Promise<number> {
  const waiting = await tx.orderAllocation.findMany({
    where: {
      status: "AWAITING_FUNDING",
      masterOrder: { opportunityId },
    },
    select: { id: true, expectedPreparationDays: true },
  });

  for (const allocation of waiting) {
    await tx.orderAllocation.update({
      where: { id: allocation.id },
      data: {
        status: "AWAITING_PREPARATION",
        preparationDueAt: new Date(
          closedAt.getTime() + allocation.expectedPreparationDays * 24 * 3600_000
        ),
      },
    });
  }

  return waiting.length;
}
