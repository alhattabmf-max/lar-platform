import { CheckoutSessionStatus, Prisma } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { BusinessException } from "./errors/business-exception";

/**
 * WHAT MAY BE REMOVED, AND WHAT GOES WITH IT — one rule, four doors.
 *
 * «نفّذها الأربعة دام المشتري ما بعد دفع.»
 *
 * The supplier removes his offer and his product; the administrator
 * removes the same two. Four screens, and the owner gave all four ONE
 * condition — nobody has paid — so the condition is written once here
 * rather than four times. A change to it cannot now reach three doors
 * and miss the fourth, and the four cannot drift into disagreeing
 * about what «عملية» means.
 *
 * PAYMENT IS THE LINE, NOT A CHECKOUT. An abandoned basket is a buyer
 * who changed their mind: it leaves rows behind, and those rows are
 * the trace of an attempt — worth keeping while the offer lives, worth
 * nothing once it does not. Nothing was sold, nobody is owed, and no
 * invoice names it. Money is what turns a row into a record.
 *
 * THIS IS A CHANGE OF RULE, AND A DELIBERATE ONE. What stood here
 * before refused on ANY checkout row, abandoned ones included, and
 * — worse — the supplier's own «حذف العرض» quietly ARCHIVED his
 * product as a way of honouring that refusal. The owner found two
 * products he could neither sell nor delete, and this is the answer:
 * removing an offer removes the offer, removing a product removes the
 * product, and only a payment stops either.
 */

/** A basket somebody is holding right now, not one they walked away from. */
export const LIVE_CHECKOUT_STATUSES = [
  CheckoutSessionStatus.LOCKED,
  CheckoutSessionStatus.PAYMENT_PENDING,
];

export interface RemovalVerdict {
  /** Somebody is mid-purchase. Temporary: the lock expires on its own. */
  liveCheckout: boolean;
  /** Somebody paid. Permanent. */
  paid: boolean;
}

/**
 * Whether these offers may be removed, and why not when they may not.
 *
 * THREE INDEPENDENT WITNESSES TO A PAYMENT, and any one of them is
 * enough. The funded quantity is the offer's own tally, a PAID session
 * is the buyer's side of it and a master order is the platform's — the
 * payment webhook writes all three in one transaction, so in practice
 * they agree, and a row that lost its partner still speaks here.
 *
 * `db` IS A CLIENT, NOT A SERVICE, so this can be asked inside the
 * transaction that does the deleting as easily as before it. Both
 * matter: the check outside is what produces a clean refusal, the one
 * inside is what makes it true at the moment of the write.
 */
export async function removalVerdict(
  db: Prisma.TransactionClient,
  opportunityIds: string[]
): Promise<RemovalVerdict> {
  if (opportunityIds.length === 0) return { liveCheckout: false, paid: false };

  const [live, paidSessions, orders, funded] = await Promise.all([
    db.checkoutSession.count({
      where: { opportunityId: { in: opportunityIds }, status: { in: LIVE_CHECKOUT_STATUSES } },
    }),
    db.checkoutSession.count({
      where: { opportunityId: { in: opportunityIds }, status: CheckoutSessionStatus.PAID },
    }),
    db.masterOrder.count({ where: { opportunityId: { in: opportunityIds } } }),
    db.opportunity.count({
      where: { id: { in: opportunityIds }, fundedQuantity: { gt: 0 } },
    }),
  ]);

  return { liveCheckout: live > 0, paid: paidSessions > 0 || orders > 0 || funded > 0 };
}

/**
 * The same verdict, as a refusal — because every one of the doors
 * refuses for the same two reasons and should say the same two things.
 *
 * IT GUARDS THE EDITS TOO, not only the deletes. «احذف العرض أو
 * عدّله دام ما عليه أي عملية» is one sentence about two acts, and
 * changing the price under somebody who paid it is the same wrong as
 * deleting what they bought.
 */
export async function assertNoBuyerCommitted(
  db: Prisma.TransactionClient,
  opportunityIds: string[]
): Promise<void> {
  const verdict = await removalVerdict(db, opportunityIds);

  if (verdict.liveCheckout) {
    // A PERSON, NOT A RECORD. Removing what somebody is holding is
    // worse than making the supplier wait a few minutes, and unlike
    // every other refusal here this one stops being true by itself.
    throw new BusinessException(
      409,
      ERROR_CODES.BUYER_CHECKOUT_IN_PROGRESS,
      "A buyer is checking out on this offer right now"
    );
  }

  if (verdict.paid) {
    throw new BusinessException(
      409,
      ERROR_CODES.BUYER_ALREADY_PAID,
      "A buyer has paid on this offer"
    );
  }
}

/**
 * Deletes offers and everything that hung off them.
 *
 * THE DEAD BASKETS GO WITH THE OFFER, AND ONLY WITH IT. No screen
 * offers «امسح الجلسات»: these rows are the trace of abandoned
 * attempts, and that trace is how somebody who locks a supplier's
 * stock and never pays is caught. They are removed as part of an act
 * somebody took for a reason the audit log records — never on their
 * own — and by the time this runs `assertNoBuyerCommitted` has established
 * that not one of them was paid.
 *
 * DEEPEST FIRST. The allocation and the quote both hang off the
 * session, and the allocation's sum check is DEFERRED — it refuses a
 * partial delete that leaves the session behind, correctly, because
 * then the total genuinely stops matching. Delete the session too and
 * the check finds no session and stands down.
 */
export async function deleteOffersTx(
  tx: Prisma.TransactionClient,
  opportunityIds: string[]
): Promise<void> {
  if (opportunityIds.length === 0) return;

  const sessions = await tx.checkoutSession.findMany({
    where: { opportunityId: { in: opportunityIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  if (sessionIds.length > 0) {
    await tx.checkoutLocationAllocation.deleteMany({
      where: { checkoutSessionId: { in: sessionIds } },
    });
    await tx.quoteSnapshot.deleteMany({ where: { checkoutSessionId: { in: sessionIds } } });
    await tx.paymentAttempt.deleteMany({ where: { checkoutSessionId: { in: sessionIds } } });
    await tx.checkoutSession.deleteMany({ where: { id: { in: sessionIds } } });
  }

  await tx.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
}

/**
 * Deletes a product and everything that hung off it, offers included.
 *
 * CHILDREN FIRST, AND IN DEPENDENCY ORDER. Nothing here cascades at
 * the database level, so the order is the constraint graph read
 * backwards: evidence hangs off a report, an offer holds the snapshot
 * it was published from, and the product holds the rest.
 *
 * THE APPROVAL SNAPSHOT GOES TOO, and it is allowed to: the database
 * refuses to delete a snapshot only while a PUBLISHED OFFER still
 * reads it (`snapshot_deletable_when_unreferenced`), and the offers
 * were deleted one line above. The old rule was unconditional, and the
 * code that feared it archived products instead of deleting them long
 * after the fear expired.
 */
export async function deleteProductTx(
  tx: Prisma.TransactionClient,
  productId: string
): Promise<{ offersDeleted: number }> {
  const reports = await tx.productReport.findMany({
    where: { productId },
    select: { id: true },
  });
  if (reports.length > 0) {
    await tx.productReportEvidence.deleteMany({
      where: { reportId: { in: reports.map((report) => report.id) } },
    });
    await tx.productReport.deleteMany({ where: { productId } });
  }

  const offers = await tx.opportunity.findMany({ where: { productId }, select: { id: true } });
  await deleteOffersTx(
    tx,
    offers.map((offer) => offer.id)
  );

  await tx.productApprovalSnapshot.deleteMany({ where: { productId } });
  await tx.productMedia.deleteMany({ where: { productId } });
  await tx.product.delete({ where: { id: productId } });

  return { offersDeleted: offers.length };
}
