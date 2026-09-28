import { Injectable } from "@nestjs/common";
import {
  CheckoutSessionStatus,
  DisputeStatus,
  MasterOrderStatus,
  OpportunityStatus,
  PaymentAttemptStatus,
  RefundObligationStatus,
} from "@prisma/client";
import type {
  CompanyDeletionBlocker,
  CompanyDeletionEligibility,
} from "@platform/types";
import { PrismaService } from "../../database/prisma.service";

/**
 * Whether a company can be removed from the platform, and what stops it.
 *
 * ONE PLACE, ON THE SERVER. The screen disables a button with this, and
 * the delete endpoint refuses with it — the same function, so a caller
 * who skips the screen and posts straight at the route meets exactly
 * the same answer. A disabled button is a courtesy; this is the rule.
 *
 * WHAT CHANGED, AND WHY. This used to refuse a removal because the
 * company had a bank account, or had accepted the terms, or had ever
 * opened a checkout — none of which is a reason to keep a company that
 * owes nothing and is owed nothing. A company that registered, filled
 * its record in and never traded could not be removed at all, which
 * made the feature useless in the one case it was for.
 *
 * WHAT STOPS A REMOVAL is unfinished business: work in progress, money
 * in motion, or a question still open. Those are the six below.
 *
 * AND WHAT THE DATABASE ITSELF STOPS. Two of the old blockers stay,
 * because they are not policy — they are physics. A `master_orders` row
 * points at the supplier's bank account and at the checkout session it
 * came from, and a `payment_attempts` row points at the policy
 * acceptance in force when it was taken; all three are ON DELETE
 * RESTRICT. A product report points at the product. So a company that
 * has traded cannot be swept away without taking a financial record
 * with it, and no rule here can change that. They are reported as their
 * own blockers so an operator reads a sentence rather than a foreign
 * key violation.
 *
 * `audit_logs` is deliberately NOT a blocker. Its `company_id` is a
 * plain nullable column with no foreign key — which is what makes this
 * feature possible at all: the record of who removed a company, when
 * and why outlives the company, and no line is deleted to make a
 * removal happen.
 */

/** A dispute nobody has finished with. */
const OPEN_DISPUTE_STATUSES = [
  DisputeStatus.OPEN,
  DisputeStatus.SUPPLIER_RESPONDED,
  DisputeStatus.AWAITING_REPLACEMENT,
];

/**
 * An opportunity that is live, or has taken money.
 *
 * DRAFT, EXPIRED and CANCELLED are absent on purpose: a draft nobody
 * saw and a run that ended leave nothing to finish.
 */
const ACTIVE_OR_FUNDED_STATUSES = [
  OpportunityStatus.SCHEDULED,
  OpportunityStatus.ACTIVE,
  OpportunityStatus.PAUSED,
  OpportunityStatus.ACTION_REQUIRED,
  OpportunityStatus.FUNDED,
];

/** A checkout that is holding stock, or money, right now. */
const HOLDING_STATUSES = [
  CheckoutSessionStatus.LOCKED,
  CheckoutSessionStatus.PAYMENT_PENDING,
];

/** A payment still in flight — neither taken nor given up on. */
const IN_FLIGHT_PAYMENT_STATUSES = [
  PaymentAttemptStatus.CREATED,
  PaymentAttemptStatus.PENDING,
];

/** A refund that has not reached the buyer. */
const UNFINISHED_REFUND_STATUSES = [
  RefundObligationStatus.PENDING_EXECUTION,
  RefundObligationStatus.SENT,
  RefundObligationStatus.FAILED,
];

@Injectable()
export class CompanyDeletionEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Counts every reason a company must stay, in one read.
   *
   * Counts rather than existence checks: an operator who is told "12
   * orders" knows what they are looking at, and "orders exist" tells
   * them only that they cannot proceed.
   */
  async check(companyId: string): Promise<CompanyDeletionEligibility> {
    const onEitherSide = {
      OR: [{ traderCompanyId: companyId }, { supplierCompanyId: companyId }],
    };

    const [
      activeOrFundedProducts,
      liveOrders,
      openDisputes,
      heldAtCheckout,
      paymentsInFlight,
      incompleteRefunds,
      incompleteSettlements,
      ordersEverPlaced,
      paymentsEverTaken,
      productReports,
    ] = await this.prisma.$transaction([
      // 1. A PRODUCT THAT IS LIVE OR HAS TAKEN MONEY. Counted as
      // opportunities, because that is where a product is live or
      // funded — the product row itself carries no such state.
      this.prisma.opportunity.count({
        where: { companyId, status: { in: ACTIVE_OR_FUNDED_STATUSES } },
      }),

      // 2. AN ORDER STILL RUNNING, on either side of it.
      this.prisma.masterOrder.count({
        where: { ...onEitherSide, status: MasterOrderStatus.IN_FULFILLMENT },
      }),

      // 3. A DISPUTE NOBODY HAS FINISHED WITH. Reached through the
      // allocation's order, which is what carries the two companies.
      this.prisma.dispute.count({
        where: {
          status: { in: OPEN_DISPUTE_STATUSES },
          orderAllocation: { masterOrder: onEitherSide },
        },
      }),

      // 4a. HELD: a checkout holding stock or money right now.
      this.prisma.checkoutSession.count({
        where: { traderCompanyId: companyId, status: { in: HOLDING_STATUSES } },
      }),

      // 4b. DUE: a payment neither taken nor given up on.
      this.prisma.paymentAttempt.count({
        where: {
          status: { in: IN_FLIGHT_PAYMENT_STATUSES },
          checkoutSession: { traderCompanyId: companyId },
        },
      }),

      // 5. A REFUND THAT HAS NOT REACHED THE BUYER.
      this.prisma.refundObligation.count({
        where: {
          status: { in: UNFINISHED_REFUND_STATUSES },
          paymentAttempt: {
            checkoutSession: { traderCompanyId: companyId },
          },
        },
      }),

      // 6. A SETTLEMENT THAT SHOULD HAVE HAPPENED. The supplier's side:
      // goods delivered, and nothing paid out for them yet.
      this.prisma.orderAllocation.count({
        where: {
          payoutSettledAt: null,
          deliveredAt: { not: null },
          masterOrder: { supplierCompanyId: companyId },
        },
      }),

      // NOT POLICY — PHYSICS. An order points at the bank account and
      // the checkout session; a payment attempt points at the policy
      // acceptance and carries the refunds, the provider events and
      // the ledger behind it. All ON DELETE RESTRICT. A company that
      // has traded cannot be swept away without taking a financial
      // record with it.
      this.prisma.masterOrder.count({ where: onEitherSide }),
      this.prisma.paymentAttempt.count({
        where: { checkoutSession: { traderCompanyId: companyId } },
      }),

      // A report points at the product it names, so the product — and
      // with it the company — has to stay.
      this.prisma.productReport.count({
        where: { product: { companyId } },
      }),
    ]);

    const counts: Record<string, number> = {
      ACTIVE_OR_FUNDED_PRODUCTS: activeOrFundedProducts,
      LIVE_ORDERS: liveOrders,
      OPEN_DISPUTES: openDisputes,
      AMOUNTS_DUE_OR_HELD: heldAtCheckout + paymentsInFlight,
      INCOMPLETE_REFUNDS: incompleteRefunds,
      INCOMPLETE_SETTLEMENTS: incompleteSettlements,
      FINANCIAL_RECORDS: ordersEverPlaced + paymentsEverTaken,
      PRODUCT_REPORTS: productReports,
    };

    const blockers: CompanyDeletionBlocker[] = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => ({
        kind: kind as CompanyDeletionBlocker["kind"],
        count,
      }));

    return { allowed: blockers.length === 0, blockers };
  }
}
