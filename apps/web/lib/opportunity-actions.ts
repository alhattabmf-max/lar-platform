import {
  SUPPLIER_OPPORTUNITY_DELETABLE_STATUSES,
  SUPPLIER_OPPORTUNITY_EDITABLE_STATUSES,
  SUPPLIER_OPPORTUNITY_EXTENDABLE_STATUSES,
  SUPPLIER_OPPORTUNITY_PUBLISHABLE_STATUSES,
  type SupplierOpportunityStatus,
} from "@platform/types";

/**
 * Which opportunity actions the API will actually accept.
 *
 * The status lists come from `@platform/types`, which restates the service's
 * own `EDITABLE_STATUSES` and its publish/delete/extend guards — so the
 * vocabulary is shared rather than retyped here.
 *
 * `extend` is the one action whose gate is not status alone: the service also
 * requires `extendedAt === null` (it may be extended exactly once) and
 * `endAt` still in the future. Both are row facts, and both are checked here
 * so a button that is certain to 409 is never drawn.
 *
 * THE SERVER IS THE AUTHORITY. Publishing in particular can be refused for
 * reasons no client can see — an unverified company, an unapproved product,
 * an inactive city, a tax rate that is not configured. This gate only stops
 * buttons that could never work; the rest arrives as the server's refusal.
 */
export interface OpportunityActionGate {
  /** PATCH /companies/me/opportunities/:id */
  canUpdate: boolean;
  /** POST /companies/me/opportunities/:id/publish */
  canPublish: boolean;
  /** POST /companies/me/opportunities/:id/extend */
  canExtend: boolean;
  /** DELETE /companies/me/opportunities/:id */
  canDelete: boolean;
}

export interface OpportunityGateInput {
  status: SupplierOpportunityStatus;
  /** ISO 8601, or null. Non-null means it has already been extended once. */
  extendedAt: string | null;
  /** ISO 8601. */
  endAt: string;
}

const includes = (
  list: readonly SupplierOpportunityStatus[],
  status: SupplierOpportunityStatus
): boolean => list.includes(status);

export function opportunityActions(
  opportunity: OpportunityGateInput,
  now: Date = new Date()
): OpportunityActionGate {
  const ended = new Date(opportunity.endAt).getTime() <= now.getTime();

  return {
    canUpdate: includes(SUPPLIER_OPPORTUNITY_EDITABLE_STATUSES, opportunity.status),
    canPublish: includes(SUPPLIER_OPPORTUNITY_PUBLISHABLE_STATUSES, opportunity.status),
    // ACTIVE, never extended, and not already past its end.
    canExtend:
      includes(SUPPLIER_OPPORTUNITY_EXTENDABLE_STATUSES, opportunity.status) &&
      opportunity.extendedAt === null &&
      !ended,
    canDelete: includes(SUPPLIER_OPPORTUNITY_DELETABLE_STATUSES, opportunity.status),
  };
}

/**
 * What the supplier should do next, as a message key under
 * `supplier.opportunities.nextStep.`.
 *
 * Every one of the eight statuses resolves to one. ACTION_REQUIRED is
 * deliberately NOT one of them: it resolves per reason code instead, because
 * "something is blocking this" is not a next step — which of the ten things
 * it is, is.
 */
export function opportunityNextStepKey(status: SupplierOpportunityStatus): string {
  return `status.${status}`;
}

/**
 * Whether the listing needs the supplier to do something.
 *
 * DRAFT has never been published; ACTION_REQUIRED was published and then
 * blocked. Everything else is either running, finished, or in the platform's
 * hands.
 */
export function opportunityNeedsAttention(status: SupplierOpportunityStatus): boolean {
  return status === "DRAFT" || status === "ACTION_REQUIRED";
}
