import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { NotificationParams } from "@platform/types";
import { NotificationWriterService } from "./notification-writer.service";

/**
 * One method per business event.
 *
 * Producers call exactly one of these, inside the transaction that
 * commits the state change. Keeping the resolution logic here rather
 * than in each service means a producer's edit is a single line, and
 * the rules that matter — which company receives it, which params are
 * carried, what the dedupe key is — live in one place with one set of
 * tests.
 *
 * Every method takes the caller's `tx`. There is no overload that
 * accepts a bare client, deliberately: a notification written outside
 * the business transaction can exist without the event it describes.
 *
 * Company ids are resolved FROM THE DATABASE inside the transaction,
 * never taken from a request body. A caller cannot direct a
 * notification at a company by asking.
 */

/**
 * Money as a fixed-scale decimal STRING.
 *
 * Prisma returns Decimal; `Number()` would introduce binary
 * floating-point error into a figure someone reconciles against a bank
 * statement. `toFixed(2)` matches the Decimal(14,2) columns these
 * values come from.
 */
function money(amount: Prisma.Decimal | number | string): string {
  return typeof amount === "object" && "toFixed" in amount
    ? amount.toFixed(2)
    : Number(amount).toFixed(2);
}

@Injectable()
export class NotificationEventsService {
  constructor(private readonly writer: NotificationWriterService) {}

  // ---- Payments -------------------------------------------------------

  async paymentSucceeded(
    tx: Prisma.TransactionClient,
    input: { masterOrderId: string; traderCompanyId: string; amount: Prisma.Decimal | string; currency: string }
  ): Promise<void> {
    await this.writer.emit(tx, {
      companyId: input.traderCompanyId,
      type: "PAYMENT_SUCCEEDED",
      entityType: "master_order",
      entityId: input.masterOrderId,
      params: { orderId: input.masterOrderId, amount: money(input.amount), currency: input.currency },
    });
  }

  /**
   * The discriminator is the ATTEMPT id: a trader may legitimately fail
   * to pay twice for one checkout, and each failure is its own news.
   * Keying on the session alone would silence the second.
   */
  async paymentFailed(
    tx: Prisma.TransactionClient,
    input: {
      checkoutSessionId: string;
      paymentAttemptId: string;
      traderCompanyId: string;
      amount: Prisma.Decimal | string;
      currency: string;
    }
  ): Promise<void> {
    await this.writer.emit(tx, {
      companyId: input.traderCompanyId,
      // The CHECKOUT SESSION, not an order: a payment can fail before
      // any order exists — in fact it usually does — and the session is
      // the thing the trader can return to and retry. Claiming
      // `master_order` while carrying a session id would send the UI to
      // a record that does not exist.
      type: "PAYMENT_FAILED",
      entityType: "checkout_session",
      entityId: input.checkoutSessionId,
      params: { amount: money(input.amount), currency: input.currency },
      discriminator: input.paymentAttemptId,
    });
  }

  /**
   * Goes to the SUPPLIER, not the trader.
   *
   * The trader already receives PAYMENT_SUCCEEDED for the same instant;
   * sending them both would be two messages about one capture. The
   * supplier, for whom a new order to fulfil is genuinely new
   * information, gets this one.
   */
  async orderCreated(
    tx: Prisma.TransactionClient,
    input: { masterOrderId: string; supplierCompanyId: string }
  ): Promise<void> {
    await this.writer.emit(tx, {
      companyId: input.supplierCompanyId,
      type: "ORDER_CREATED",
      entityType: "master_order",
      entityId: input.masterOrderId,
      params: { orderId: input.masterOrderId },
    });
  }

  // ---- Fulfilment -----------------------------------------------------

  private async allocationEvent(
    tx: Prisma.TransactionClient,
    orderAllocationId: string,
    type: "ALLOCATION_PREPARATION_STARTED" | "ALLOCATION_READY" | "ALLOCATION_SHIPPED" | "ALLOCATION_DELIVERED"
  ): Promise<void> {
    const allocation = await tx.orderAllocation.findUnique({
      where: { id: orderAllocationId },
      select: { masterOrderId: true, masterOrder: { select: { traderCompanyId: true } } },
    });
    if (!allocation) return;

    await this.writer.emit(tx, {
      companyId: allocation.masterOrder.traderCompanyId,
      type,
      entityType: "order_allocation",
      entityId: orderAllocationId,
      params: { orderId: allocation.masterOrderId, allocationId: orderAllocationId },
    });
  }

  allocationPreparationStarted(tx: Prisma.TransactionClient, id: string): Promise<void> {
    return this.allocationEvent(tx, id, "ALLOCATION_PREPARATION_STARTED");
  }

  allocationReady(tx: Prisma.TransactionClient, id: string): Promise<void> {
    return this.allocationEvent(tx, id, "ALLOCATION_READY");
  }

  allocationShipped(tx: Prisma.TransactionClient, id: string): Promise<void> {
    return this.allocationEvent(tx, id, "ALLOCATION_SHIPPED");
  }

  allocationDelivered(tx: Prisma.TransactionClient, id: string): Promise<void> {
    return this.allocationEvent(tx, id, "ALLOCATION_DELIVERED");
  }

  async masterOrderFulfilled(tx: Prisma.TransactionClient, masterOrderId: string): Promise<void> {
    const order = await tx.masterOrder.findUnique({
      where: { id: masterOrderId },
      select: { traderCompanyId: true },
    });
    if (!order) return;

    await this.writer.emit(tx, {
      companyId: order.traderCompanyId,
      type: "MASTER_ORDER_FULFILLED",
      entityType: "master_order",
      entityId: masterOrderId,
      params: { orderId: masterOrderId },
    });
  }

  // ---- Disputes -------------------------------------------------------

  private async disputeParties(tx: Prisma.TransactionClient, disputeId: string) {
    return tx.dispute.findUnique({
      where: { id: disputeId },
      select: {
        orderAllocationId: true,
        orderAllocation: {
          select: {
            masterOrderId: true,
            masterOrder: { select: { traderCompanyId: true, supplierCompanyId: true } },
          },
        },
      },
    });
  }

  /** To the SUPPLIER — they are the party who has to answer it. */
  async disputeOpened(tx: Prisma.TransactionClient, disputeId: string): Promise<void> {
    const dispute = await this.disputeParties(tx, disputeId);
    if (!dispute) return;

    await this.writer.emit(tx, {
      companyId: dispute.orderAllocation.masterOrder.supplierCompanyId,
      type: "DISPUTE_OPENED",
      entityType: "dispute",
      entityId: disputeId,
      params: {
        orderId: dispute.orderAllocation.masterOrderId,
        allocationId: dispute.orderAllocationId,
        disputeId,
      },
    });
  }

  async disputeSupplierResponded(tx: Prisma.TransactionClient, disputeId: string): Promise<void> {
    const dispute = await this.disputeParties(tx, disputeId);
    if (!dispute) return;

    await this.writer.emit(tx, {
      companyId: dispute.orderAllocation.masterOrder.traderCompanyId,
      type: "DISPUTE_SUPPLIER_RESPONDED",
      entityType: "dispute",
      entityId: disputeId,
      params: { disputeId },
    });
  }

  async disputeDecided(tx: Prisma.TransactionClient, disputeId: string): Promise<void> {
    const dispute = await this.disputeParties(tx, disputeId);
    if (!dispute) return;

    await this.writer.emit(tx, {
      companyId: dispute.orderAllocation.masterOrder.traderCompanyId,
      type: "DISPUTE_DECIDED",
      entityType: "dispute",
      entityId: disputeId,
      params: { disputeId },
    });
  }

  // ---- Replacements ---------------------------------------------------

  /** To the SUPPLIER — the obligation is theirs to discharge. */
  async replacementRequired(
    tx: Prisma.TransactionClient,
    input: { replacementObligationId: string; disputeId: string }
  ): Promise<void> {
    const dispute = await this.disputeParties(tx, input.disputeId);
    if (!dispute) return;

    await this.writer.emit(tx, {
      companyId: dispute.orderAllocation.masterOrder.supplierCompanyId,
      type: "REPLACEMENT_REQUIRED",
      entityType: "replacement_obligation",
      entityId: input.replacementObligationId,
      params: {
        orderId: dispute.orderAllocation.masterOrderId,
        allocationId: dispute.orderAllocationId,
      },
    });
  }

  private async replacementEvent(
    tx: Prisma.TransactionClient,
    replacementObligationId: string,
    type: "REPLACEMENT_SHIPPED" | "REPLACEMENT_DELIVERED" | "REPLACEMENT_FAILED"
  ): Promise<void> {
    const obligation = await tx.replacementObligation.findUnique({
      where: { id: replacementObligationId },
      select: {
        originalOrderAllocationId: true,
        originalOrderAllocation: {
          select: { masterOrderId: true, masterOrder: { select: { traderCompanyId: true } } },
        },
      },
    });
    if (!obligation) return;

    await this.writer.emit(tx, {
      companyId: obligation.originalOrderAllocation.masterOrder.traderCompanyId,
      type,
      entityType: "replacement_obligation",
      entityId: replacementObligationId,
      params: {
        orderId: obligation.originalOrderAllocation.masterOrderId,
        // The ORIGINAL allocation: a replacement is fulfilled against
        // the allocation it replaces, and that is the id the trader's
        // order page is keyed on.
        allocationId: obligation.originalOrderAllocationId,
      },
    });
  }

  replacementShipped(tx: Prisma.TransactionClient, id: string): Promise<void> {
    return this.replacementEvent(tx, id, "REPLACEMENT_SHIPPED");
  }

  replacementDelivered(tx: Prisma.TransactionClient, id: string): Promise<void> {
    return this.replacementEvent(tx, id, "REPLACEMENT_DELIVERED");
  }

  replacementFailed(tx: Prisma.TransactionClient, id: string): Promise<void> {
    return this.replacementEvent(tx, id, "REPLACEMENT_FAILED");
  }

  // ---- Refunds --------------------------------------------------------

  /**
   * Resolves the paying trader from the refund obligation.
   *
   * The chain is obligation → payment attempt → checkout session, which
   * is where `trader_company_id` actually lives. `masterOrderId` may be
   * absent for a refund raised before an order existed (a capture
   * mismatch, say), in which case the obligation itself is the entity
   * the notification points at.
   */
  /**
   * Resolves the paying trader, the amount, and WHAT THE REFUND POINTS
   * AT.
   *
   * The two refund sources have genuinely different targets, and the
   * `source` column decides it — no probing:
   *
   *   PAYMENT_EXCEPTION  raised inside the capture webhook, on every
   *                      path that returns BEFORE the master order is
   *                      created (amount mismatch, duplicate capture,
   *                      late capture, unverified bank account, missing
   *                      tax policy). There is no order, so the
   *                      checkout session is what exists.
   *   DISPUTE            raised from a decision on a DELIVERED
   *                      allocation, so an order necessarily exists.
   *
   * The order is still looked up rather than assumed for the DISPUTE
   * case, and the session is the fallback — a refund with no reachable
   * target would be worse than one pointing at the session it came
   * from.
   */
  private async refundContext(tx: Prisma.TransactionClient, refundObligationId: string) {
    const obligation = await tx.refundObligation.findUnique({
      where: { id: refundObligationId },
      select: {
        amount: true,
        currency: true,
        source: true,
        paymentAttempt: {
          select: { checkoutSession: { select: { id: true, traderCompanyId: true } } },
        },
      },
    });
    if (!obligation) return null;

    const session = obligation.paymentAttempt.checkoutSession;

    // PAYMENT_EXCEPTION: no order can exist, so none is looked for.
    if (obligation.source !== "DISPUTE") {
      return {
        traderCompanyId: session.traderCompanyId,
        entityType: "checkout_session" as const,
        entityId: session.id,
        amount: obligation.amount,
        currency: obligation.currency,
      };
    }

    // DISPUTE: an order is REQUIRED. A dispute can only be opened on a
    // DELIVERED allocation, which cannot exist without one.
    const order = await tx.masterOrder.findFirst({
      where: { checkoutSessionId: session.id },
      select: { id: true },
    });

    if (!order) {
      // A genuine invariant violation — the relational graph is
      // corrupt. Falling back to the checkout session would paper over
      // that with a notification that looks fine, hiding the corruption
      // behind a plausible link. Throwing aborts the caller's
      // transaction so nothing partial is written.
      //
      // The message names ONLY the obligation id: no company, no
      // session, no amount. It is an internal integrity failure, and
      // the global error filter turns it into a generic 500 with a
      // request id, so nothing here reaches the client either.
      throw new Error(
        `Refund obligation ${refundObligationId} has source DISPUTE but no master order — ` +
          "a dispute requires a delivered allocation, so this indicates corrupt relations"
      );
    }

    return {
      traderCompanyId: session.traderCompanyId,
      entityType: "master_order" as const,
      entityId: order.id,
      amount: obligation.amount,
      currency: obligation.currency,
    };
  }

  async refundInitiated(
    tx: Prisma.TransactionClient,
    input: { refundObligationId: string; refundAttemptId: string }
  ): Promise<void> {
    const context = await this.refundContext(tx, input.refundObligationId);
    if (!context) return;

    await this.writer.emit(tx, {
      companyId: context.traderCompanyId,
      type: "REFUND_INITIATED",
      entityType: context.entityType,
      entityId: context.entityId,
      params: { amount: money(context.amount), currency: context.currency },
      discriminator: input.refundAttemptId,
    });
  }

  async refundFailed(
    tx: Prisma.TransactionClient,
    input: { refundObligationId: string; refundAttemptId: string }
  ): Promise<void> {
    const context = await this.refundContext(tx, input.refundObligationId);
    if (!context) return;

    await this.writer.emit(tx, {
      companyId: context.traderCompanyId,
      type: "REFUND_FAILED",
      entityType: context.entityType,
      entityId: context.entityId,
      params: { amount: money(context.amount), currency: context.currency },
      discriminator: input.refundAttemptId,
    });
  }

  // ---- Settlement -----------------------------------------------------

  /**
   * To the SUPPLIER. Emitted only for an EXECUTED payout — a
   * ZERO_BALANCE outcome moved no money and announcing it would be
   * noise.
   */
  async settlementExecuted(
    tx: Prisma.TransactionClient,
    input: {
      supplierPayoutId: string;
      supplierCompanyId: string;
      /** The settlement computes this as a number; `money()` fixes the scale. */
      netAmount: Prisma.Decimal | number | string;
      currency: string;
    }
  ): Promise<void> {
    await this.writer.emit(tx, {
      companyId: input.supplierCompanyId,
      type: "SETTLEMENT_EXECUTED",
      entityType: "supplier_payout",
      entityId: input.supplierPayoutId,
      params: { amount: money(input.netAmount), currency: input.currency } as NotificationParams,
    });
  }
}
