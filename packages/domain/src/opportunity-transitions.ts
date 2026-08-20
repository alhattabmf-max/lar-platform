export const OPPORTUNITY_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTION_REQUIRED",
  "ACTIVE",
  "PAUSED",
  "FUNDED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/**
 * Every legal transition, keyed by origin status. Used by
 * OpportunitiesService (manual/API-triggered transitions) and by the
 * lifecycle sweep (automatic transitions) so both consult the SAME
 * table — a transition attempted outside this table is always a bug,
 * never a judgment call made ad hoc at the call site.
 *
 * Commercial meaning of each status (targetQuantity is a supply CAP
 * the supplier is willing to sell, never a collective goal that must
 * be reached before any order proceeds — every paid order is created
 * and sent for fulfillment immediately, independent of how much of
 * the cap is sold):
 * - ACTIVE: currently accepts new paid orders.
 * - FUNDED: the supply cap is fully sold ("sold out") — stops NEW
 *   sales only. Never affects any already-paid order.
 * - EXPIRED: the sales window has closed — stops NEW sales only.
 *   Never cancels a paid order, never triggers a refund, never
 *   reverses fundedQuantity.
 * - PAUSED: temporary hold on NEW sales only, admin-triggered.
 * - CANCELLED: the opportunity is closed to NEW sales permanently.
 * - ACTION_REQUIRED: invisible to traders until the supplier fixes
 *   the underlying blocker and republishes.
 */
export const OPPORTUNITY_TRANSITIONS: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  DRAFT: ["SCHEDULED", "ACTIVE", "CANCELLED"],
  SCHEDULED: ["ACTIVE", "ACTION_REQUIRED", "CANCELLED", "SCHEDULED"], // SCHEDULED->SCHEDULED: editing before due
  ACTION_REQUIRED: ["SCHEDULED", "ACTIVE"], // only via supplier re-publish, after fixing the blocker
  ACTIVE: ["FUNDED", "EXPIRED", "PAUSED", "CANCELLED", "ACTIVE"], // ACTIVE->ACTIVE: extension
  PAUSED: ["ACTIVE", "EXPIRED", "CANCELLED"],
  FUNDED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function isValidOpportunityTransition(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return OPPORTUNITY_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses that must never be visible in trader/public discovery listings. */
export const OPPORTUNITY_TRADER_VISIBLE_STATUSES: readonly OpportunityStatus[] = ["ACTIVE"];

/** Statuses considered "published" — i.e. no longer a private draft. */
export const OPPORTUNITY_PUBLISHED_STATUSES: readonly OpportunityStatus[] = [
  "SCHEDULED",
  "ACTION_REQUIRED",
  "ACTIVE",
  "PAUSED",
  "FUNDED",
  "EXPIRED",
];
