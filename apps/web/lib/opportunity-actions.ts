import {
  SUPPLIER_OPPORTUNITY_DELETABLE_STATUSES,
  SUPPLIER_OPPORTUNITY_EDITABLE_STATUSES,
  SUPPLIER_OPPORTUNITY_EXTENDABLE_STATUSES,
  SUPPLIER_OPPORTUNITY_LIVE_STATUSES,
  SUPPLIER_OPPORTUNITY_PUBLISHABLE_STATUSES,
  type SaleMode,
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
  /**
   * POST /companies/me/opportunities/:id/stop — a DIRECT listing only.
   *
   * «يوقف المورد النشرة وينشئ واحدة جديدة بالسعر الجديد.» This is how a
   * price changes on a listing that has sales: it does not — the terms
   * are frozen on the row every order, invoice and settlement points
   * back at, so the supplier ends this listing and publishes another.
   *
   * ON SALE MEANS ACTIVE OR PAUSED. There is nothing to stop about a
   * draft, and a listing already cancelled is already stopped.
   */
  canStop: boolean;
  /**
   * POST /companies/me/opportunities/:id/close-at-reached
   *
   * «إذا قرر أن تقفل الصفقة ويعتمدها أوك» — take what the offer reached
   * rather than let it go back to the buyers. Only inside the window,
   * and only if anything was bought at all.
   */
  canCloseAtReached: boolean;
  /**
   * True while the supplier's 24 hours are running.
   *
   * Not an action — what the SCREEN needs to show the clock and say why
   * two buttons have appeared on an offer whose selling window closed.
   */
  decisionWindowOpen: boolean;
}

export interface OpportunityGateInput {
  status: SupplierOpportunityStatus;
  /** Which of the two sales paths this listing is. */
  saleMode: SaleMode;
  /** ISO 8601, or null. Non-null means it has already been extended once. */
  extendedAt: string | null;
  /**
   * ISO 8601, or NULL for a direct sale — a shelf has no window.
   *
   * Everything this gate derives from it is about a window closing, so
   * a listing without one is simply never "ended": it cannot be
   * extended, no decision window can open on it, and it stays the
   * supplier's to edit and stop for as long as it exists.
   */
  endAt: string | null;
  /** ISO 8601, or null. Non-null and in the future means the window runs. */
  decisionWindowClosesAt: string | null;
  /** How much of the target has been bought. */
  fundedQuantity: number;
}

const includes = (
  list: readonly SupplierOpportunityStatus[],
  status: SupplierOpportunityStatus
): boolean => list.includes(status);

export function opportunityActions(
  opportunity: OpportunityGateInput,
  now: Date = new Date()
): OpportunityActionGate {
  const ended =
    opportunity.endAt !== null && new Date(opportunity.endAt).getTime() <= now.getTime();

  // THE SUPPLIER'S 24 HOURS, OPENED BY THE CLOCK when an offer's window
  // closed without filling. «فرصة وصلت ستين بالمئة… هنا مهلة تعطى للمورد
  // مدة 24 ساعة» — and «يقرر المورد في العرض نفسه».
  const decisionWindowOpen =
    opportunity.decisionWindowClosesAt !== null &&
    new Date(opportunity.decisionWindowClosesAt).getTime() > now.getTime();

  return {
    canUpdate: includes(SUPPLIER_OPPORTUNITY_EDITABLE_STATUSES, opportunity.status),
    canPublish: includes(SUPPLIER_OPPORTUNITY_PUBLISHABLE_STATUSES, opportunity.status),
    // ACTIVE and never extended — and past its end ONLY while the
    // decision window is open, which is exactly when an extension is
    // wanted. Refusing every ended offer refused the one case the
    // option exists for; the server was corrected the same way.
    // NOTHING WITH NO WINDOW CAN BE EXTENDED. A direct listing has no
    // `endAt` and no `extendedAt`, and the API refuses the call — so
    // the button is never drawn rather than drawn and refused.
    canExtend:
      opportunity.saleMode !== "DIRECT" &&
      includes(SUPPLIER_OPPORTUNITY_EXTENDABLE_STATUSES, opportunity.status) &&
      opportunity.extendedAt === null &&
      (!ended || decisionWindowOpen),
    // «إذا كان عليه عملية شراء يطلب المورد من الإدارة إلغاء العرض»
    // — an offer with buyers on it is not the supplier's to remove, and
    // during the window it is doubly not: the same screen is asking
    // them to choose between closing and extending. A third button that
    // reads "delete" beside those two would be a fourth answer to a
    // question that has three.
    canDelete:
      includes(SUPPLIER_OPPORTUNITY_DELETABLE_STATUSES, opportunity.status) &&
      !(decisionWindowOpen && opportunity.fundedQuantity > 0),
    // NOTHING TO CLOSE IF NOBODY BOUGHT. The server refuses it too; the
    // button is simply never drawn for an offer at zero.
    canCloseAtReached: decisionWindowOpen && opportunity.fundedQuantity > 0,
    // A DIRECT LISTING ON SALE. Never a group offer: that one ends by
    // its own window, or by an administrator who must decide about the
    // money its buyers are still waiting on.
    canStop:
      opportunity.saleMode === "DIRECT" &&
      (opportunity.status === "ACTIVE" || opportunity.status === "PAUSED"),
    decisionWindowOpen,
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

/**
 * Whether this offer is still standing between its product and a second one.
 *
 * THE OWNER'S RULE: «لا يُنشر عرض ثانٍ على المنتج إلا بعد انتهاء العرض
 * الأول.» Two live offers on one product compete for the same stock and
 * can between them sell more than the supplier has.
 *
 * THE LIST IS THE CONTRACT'S, not this file's. `publish()` refuses a
 * second publication on exactly these four statuses; a copy written out
 * here would eventually disagree with the server, and the disagreement
 * would show up as a button that leads straight to a refusal.
 */
export function opportunityIsLive(status: SupplierOpportunityStatus): boolean {
  return includes(SUPPLIER_OPPORTUNITY_LIVE_STATUSES, status);
}
