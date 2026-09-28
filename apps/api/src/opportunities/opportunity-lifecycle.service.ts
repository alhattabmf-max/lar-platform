import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AuditActorType, Prisma, RefundObligationReasonCode } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { refundOfferPaymentsTx } from "./refund-offer-payments.util";

/**
 * HOW LONG A SUPPLIER HAS TO DECIDE ON A PARTLY FUNDED OFFER.
 *
 * «إذا لم ينفذ الخيارين تنتهي الفرصة وتسترد الأموال تلقائي… أما خلال
 *  الأربعة وعشرين ساعة يكون عنده خيار التمديد.»
 *
 * IN THE CODE, NOT IN SETTINGS, and that is the owner's own decision:
 * this window is a promise made to the BUYER, whose money is already
 * captured and waiting. An operator who could widen it to seventy-two
 * hours with one field would be changing what a buyer agreed to after
 * they paid. The extension DAYS are configurable; this is not.
 */
const SUPPLIER_DECISION_WINDOW_HOURS = 24;

/**
 * THE CLOCK THIS PLATFORM DID NOT HAVE.
 *
 * Before this service there was no scheduler of any kind — no `@Cron`,
 * no queue, and 145 outbox events with no consumer. Nothing ended an
 * offer when its window closed; a status changed only when a person
 * pressed something. "Automatic" was a word with no mechanism behind it.
 *
 * WHY IT ARRIVED WITH THE FUNDING GATE AND NOT AFTER IT. Making
 * fulfilment wait for the target left one case worse than before: an
 * offer that never reaches its target used to ship anyway, and now it
 * would leave every buyer's share in `AWAITING_FUNDING` for good — money
 * captured, no goods, no refund. The gate is right and this is its
 * other half, so the two land together.
 *
 * IDEMPOTENT BY CLAIM, NEVER BY READ-THEN-WRITE. Every transition below
 * is an UPDATE with the old state in its WHERE clause, so two ticks that
 * overlap cannot both act on one row. A scheduler that assumed it was
 * alone would double-refund the first time it was run twice.
 */
@Injectable()
export class OpportunityLifecycleService {
  private readonly logger = new Logger(OpportunityLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * EVERY MINUTE, AND DELIBERATELY NOT MORE OFTEN.
   *
   * The finest deadline this platform holds is a 24-hour window; a
   * minute of drift on it is invisible to everyone. Running by the
   * second would cost a query per second to end nothing.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    try {
      await this.closeExpiredOffers();
      await this.closeElapsedDecisionWindows();
    } catch (error) {
      // A FAILED TICK IS NOT A CRASHED SERVER. The next one is sixty
      // seconds away and every step re-claims its own rows, so the work
      // simply happens then.
      this.logger.error(
        `opportunity lifecycle tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * OFFERS WHOSE SALES WINDOW HAS PASSED.
   *
   * Three outcomes, and the difference is what was sold:
   *
   *   nothing sold      -> EXPIRED, and there is nothing to give back
   *   sold, not funded  -> the supplier's 24-hour decision window opens
   *   funded            -> already closed at the moment it filled, by
   *                        the payment webhook; never reached here
   */
  private async closeExpiredOffers(): Promise<void> {
    const due = await this.prisma.$queryRaw<
      { id: string; funded_quantity: number; company_id: string }[]
    >`
      SELECT id, funded_quantity, company_id
      FROM opportunities
      WHERE status IN ('ACTIVE', 'PAUSED')
        -- A SHELF DOES NOT EXPIRE. A DIRECT listing has no end_at at
        -- all — opportunities_sale_mode_window holds it NULL — so it
        -- could never match the comparison below; naming the mode says
        -- WHY rather than leaving a NULL to imply it.
        AND sale_mode = 'GROUP'
        AND end_at <= now()
        AND decision_window_closes_at IS NULL
        -- AND IT DID NOT FILL. A filled offer is already FUNDED and
        -- cannot match the status filter above, so this is belt and
        -- braces — but a future status added to that list must not
        -- silently start refunding offers that succeeded.
        AND funded_quantity < target_quantity
      FOR UPDATE SKIP LOCKED
    `;

    for (const offer of due) {
      if (offer.funded_quantity > 0) {
        await this.openDecisionWindow(offer.id, offer.company_id);
      } else {
        await this.expireWithNothingSold(offer.id, offer.company_id);
      }
    }
  }

  /**
   * NOBODY BOUGHT: the offer simply ends.
   *
   * No refund obligation is written, because no money was ever taken —
   * an obligation for zero would be a row that says a debt exists.
   */
  private async expireWithNothingSold(opportunityId: string, companyId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        UPDATE opportunities SET status = 'EXPIRED', updated_at = now()
        WHERE id = ${opportunityId}::uuid AND status IN ('ACTIVE', 'PAUSED')
      `;
      if (claimed === 0) return;

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          companyId,
          action: "OPPORTUNITY_EXPIRED_UNSOLD",
          entityType: "opportunity",
          entityId: opportunityId,
          requestId: `lifecycle:${opportunityId}`,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "OPPORTUNITY_EXPIRED_UNSOLD",
          payload: { opportunityId } as Prisma.InputJsonValue,
        },
      });
    });
  }

  /**
   * SOLD SOMETHING, DID NOT FILL: the supplier gets 24 hours.
   *
   * «فرصة لم تصل هدفها مئة بالمئة، بل وصلت ستين بالمئة… هنا يكون فيه
   *  مهلة تعطى للمورد مدة 24 ساعة: إذا قرر أن تقفل الصفقة ويعتمدها أوك،
   *  وإذا أراد أن تكتمل مئة بالمئة فعنده خيار التمديد.»
   *
   * THE OFFER STAYS OUT OF `EXPIRED` WHILE THE WINDOW RUNS, because
   * EXPIRED is a terminal state in the transition table and an extension
   * has to be able to put it back to ACTIVE. What marks the window is a
   * date, not a status — so nothing about the existing state machine has
   * to be loosened to make room for it.
   */
  private async openDecisionWindow(opportunityId: string, companyId: string): Promise<void> {
    const closesAt = new Date(Date.now() + SUPPLIER_DECISION_WINDOW_HOURS * 3600_000);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        UPDATE opportunities
        SET decision_window_closes_at = ${closesAt}, updated_at = now()
        WHERE id = ${opportunityId}::uuid
          AND status IN ('ACTIVE', 'PAUSED')
          AND decision_window_closes_at IS NULL
      `;
      if (claimed === 0) return;

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          companyId,
          action: "OPPORTUNITY_DECISION_WINDOW_OPENED",
          entityType: "opportunity",
          entityId: opportunityId,
          afterData: { decisionWindowClosesAt: closesAt.toISOString() } as Prisma.InputJsonValue,
          requestId: `lifecycle:${opportunityId}`,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "OPPORTUNITY_DECISION_WINDOW_OPENED",
          payload: { opportunityId, closesAt: closesAt.toISOString() } as Prisma.InputJsonValue,
        },
      });
    });
  }

  /**
   * THE 24 HOURS PASSED AND THE SUPPLIER DID NEITHER THING.
   *
   * «إذا لم ينفذ الخيارين تنتهي الفرصة وتسترد الأموال تلقائي.»
   *
   * SILENCE MEANS REFUND, which is the only safe default: the buyer's
   * money is already captured and waiting, so an offer nobody decided on
   * must return it rather than hold it.
   */
  private async closeElapsedDecisionWindows(): Promise<void> {
    const elapsed = await this.prisma.$queryRaw<{ id: string; company_id: string }[]>`
      SELECT id, company_id
      FROM opportunities
      WHERE status IN ('ACTIVE', 'PAUSED')
        AND decision_window_closes_at IS NOT NULL
        AND decision_window_closes_at <= now()
      FOR UPDATE SKIP LOCKED
    `;

    for (const offer of elapsed) {
      await this.expireAndRefund(
        offer.id,
        offer.company_id,
        RefundObligationReasonCode.TARGET_NOT_REACHED
      );
    }
  }

  /**
   * END THE OFFER AND GIVE EVERY BUYER BACK EVERYTHING THEY PAID.
   *
   * IN FULL, INCLUDING SHIPPING. «الشحن أصلاً مربوط كل مشتري برسوم شحن
   * معينة على حسب مدينته ومنطقته» — and not one of those fees was ever
   * spent, because nothing was ever shipped. Keeping them would be
   * charging for a carriage that did not happen. The owner's fault-based
   * rule applies to goods that WERE shipped and came back; there, a
   * carrier really was paid.
   *
   * ONE OBLIGATION PER PAYMENT, not per allocation: the refund is made
   * against the payment attempt that took the money, which is the only
   * thing the provider can reverse.
   *
   * NO COMMISSION IS TOUCHED, because none was ever earned — commission
   * is computed per order at capture and this offer produced no order
   * that survives.
   */
  private async expireAndRefund(
    opportunityId: string,
    companyId: string,
    reasonCode: RefundObligationReasonCode
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        UPDATE opportunities SET status = 'EXPIRED', updated_at = now()
        WHERE id = ${opportunityId}::uuid AND status IN ('ACTIVE', 'PAUSED')
      `;
      if (claimed === 0) return;

      const refunded = await refundOfferPaymentsTx(tx, opportunityId, reasonCode);

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          companyId,
          action: "OPPORTUNITY_EXPIRED_REFUNDED",
          entityType: "opportunity",
          entityId: opportunityId,
          afterData: { refundedPayments: refunded, reasonCode } as Prisma.InputJsonValue,
          requestId: `lifecycle:${opportunityId}`,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "OPPORTUNITY_EXPIRED_REFUNDED",
          payload: {
            opportunityId,
            refundedPayments: refunded,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }
}
