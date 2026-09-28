import type { OpportunityStatus } from "./opportunity-transitions";

/**
 * TWO WAYS TO SELL, ONE RECORD.
 *
 * `GROUP` is the platform as it was: a collective offer with a target,
 * a share every buyer takes, a window it runs for, and fulfilment that
 * waits until the target is reached — `AWAITING_FUNDING`, then `FUNDED`,
 * then preparation begins for everyone at once.
 *
 * `DIRECT` is a fixed-price sale from stock. The supplier names a price
 * and a quantity; a buyer takes whatever amount they want up to what is
 * left; the order goes to preparation the moment the payment succeeds.
 * There is no target to reach, no share, no window and no `FUNDED`.
 *
 * WHY A COLUMN AND NOT A SECOND TABLE. Everything downstream of the
 * purchase is identical — the lock, the quote, the payment attempt, the
 * master order, the allocations, shipping, disputes, refunds,
 * settlement, invoices. A separate entity would have had to be threaded
 * through every one of them, and `checkout_sessions.opportunity_id` is
 * the single foreign key the whole money path hangs from. One
 * discriminator on the row they already point at costs one column; a
 * second table costs a second copy of the money path.
 *
 * THE AVAILABILITY ARITHMETIC WAS ALREADY THERE. `target_quantity −
 * funded_quantity − active locks`, computed after `SELECT … FOR UPDATE`
 * on the offer row, is precisely what stock control needs, and it has
 * been holding the line against overselling since Phase 7B. DIRECT
 * reuses it unchanged rather than introducing an inventory of its own.
 */
export const SALE_MODES = ["GROUP", "DIRECT"] as const;

export type SaleMode = (typeof SALE_MODES)[number];

/**
 * Statuses each mode may ever hold.
 *
 * DIRECT NEVER REACHES `FUNDED`. It is terminal in
 * `OPPORTUNITY_TRANSITIONS` — nothing leaves it — and it means "the
 * collective target was reached". A DIRECT listing that sold its last
 * unit has not finished: the supplier restocks and it sells again. Its
 * sold-out state is `ACTIVE` with nothing available, which is a reading
 * of the numbers, not a status.
 *
 * DIRECT NEVER REACHES `EXPIRED` either, because it has no window to
 * close, and never `SCHEDULED`, because it is published straight onto
 * the market.
 */
export const SALE_MODE_STATUSES: Record<SaleMode, readonly OpportunityStatus[]> = {
  GROUP: ["DRAFT", "SCHEDULED", "ACTION_REQUIRED", "ACTIVE", "PAUSED", "FUNDED", "EXPIRED", "CANCELLED"],
  DIRECT: ["DRAFT", "ACTION_REQUIRED", "ACTIVE", "PAUSED", "CANCELLED"],
};

export function saleModeAllowsStatus(mode: SaleMode, status: OpportunityStatus): boolean {
  return SALE_MODE_STATUSES[mode].includes(status);
}

/**
 * What a buyer may still take.
 *
 * THE SAME THREE NUMBERS FOR BOTH MODES, and the same meaning: the
 * supplier's cap, what has actually been paid for, and what other
 * buyers are holding right now in live baskets and unfinished payments.
 *
 * ONLY MEANINGFUL UNDER THE OFFER'S ROW LOCK. Read without it this is a
 * snapshot that can be stale by the time it is acted on, which is why
 * the checkout recomputes it inside `SELECT … FOR UPDATE` and why a
 * value shown on a screen is a guide, never a promise.
 *
 * NEVER NEGATIVE. Locks are released and stock can be lowered to the
 * floor but no further, so the arithmetic should not go below zero; if
 * it ever does, clamping is the honest answer to a buyer, not a
 * negative quantity on a page.
 */
export function availableQuantity(input: {
  targetQuantity: number;
  fundedQuantity: number;
  activeLockedQuantity: number;
}): number {
  return Math.max(0, input.targetQuantity - input.fundedQuantity - input.activeLockedQuantity);
}

/**
 * The floor a DIRECT stock edit may not go below.
 *
 * «المورد يستطيع تعديل المخزون صعودًا أو هبوطًا بشرط
 *  `new target_quantity >= funded_quantity + activeLocks`».
 *
 * WHAT IS ALREADY SOLD CANNOT BE UNSOLD, and what another buyer is
 * holding in a live basket has been promised to them for the length of
 * that lock. Lowering stock below either is not a smaller shelf — it is
 * a sale taken back from somebody who already has it.
 */
export function minimumDirectStock(input: {
  fundedQuantity: number;
  activeLockedQuantity: number;
}): number {
  return input.fundedQuantity + input.activeLockedQuantity;
}
