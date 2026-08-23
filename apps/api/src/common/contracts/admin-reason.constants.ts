/**
 * The bounds on a written reason an administrator must supply.
 *
 * Every administrative action that DENIES something — rejecting a
 * supplier's verification, rejecting a product, rejecting a bank
 * account, suspending or closing a product, pausing or cancelling an
 * opportunity, disabling a colleague's account — requires one, and all
 * of them use these bounds.
 *
 * A MINIMUM because "x" is not a reason. Several of these texts are
 * delivered to the company as the explanation for why they cannot
 * trade, and the rest are the audit record of a decision; a trail of
 * single characters is no trail at all.
 *
 * A MAXIMUM because this is stored text on a row that is retained
 * indefinitely.
 *
 * The reason is TRIMMED before its length is measured, so a field of
 * spaces cannot satisfy the minimum.
 *
 * These live in `common/contracts` rather than in one feature's DTO
 * folder because six modules depend on them, and a per-module copy is
 * how one of them ends up with a different minimum.
 */
export const ADMIN_REASON_MIN = 5;
export const ADMIN_REASON_MAX = 2000;
