import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma, RefundObligationReasonCode } from "@prisma/client";
import { isValidOpportunityTransition, type OpportunityStatus, type SaleMode } from "@platform/domain";
import { PrismaService } from "../../database/prisma.service";
import { BusinessException } from "../../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { MoneyString } from "@platform/types";
import type { ListAdminOpportunitiesQueryDto } from "./dto/list-admin-opportunities-query.dto";
import { releaseActiveLocksForOpportunityTx } from "../../checkout/checkout-lock-release.util";
import { refundOfferPaymentsTx } from "../../opportunities/refund-offer-payments.util";
import { OpportunitiesService } from "../../opportunities/opportunities.service";
import type { UpdateOpportunityDto } from "../../opportunities/dto/update-opportunity.dto";
import { assertNoBuyerCommitted, deleteOffersTx } from "../../common/removal";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Money leaves this service as a fixed-scale decimal STRING.
 *
 * Until this replaced them, the four monetary fields below were mapped
 * with `Decimal.toNumber()` — the same defect proved and fixed on the
 * supplier opportunity surface in 8E.4, still present here because the
 * admin view has its own mapper. JSON has one numeric type, IEEE-754
 * binary double, in which `125.50` is not representable exactly, so a
 * figure that left a `Decimal(12,2)` column and the figure the operator
 * saw were different numbers that merely printed the same. These are
 * the amounts an operator reconciles against a supplier's expectation
 * of what an opportunity was worth.
 *
 * `taxRatePercent` is a RATE, not money, and is given the same
 * fixed-scale string treatment for the same reason: it is a
 * `Decimal(5,2)` and a double cannot hold every value that column can.
 *
 * `sharePercentage` stays a number. It is derived from
 * `shareBasisPoints`, an INTEGER column, and integer-over-100 is exact
 * in a double for every value this system can store — there is no
 * decimal to lose.
 */
const money = (amount: Prisma.Decimal): MoneyString => amount.toFixed(2);
const moneyOrNull = (amount: Prisma.Decimal | null): MoneyString | null =>
  amount === null ? null : amount.toFixed(2);

export interface AdminOpportunityView {
  id: string;
  companyId: string;
  productId: string;
  fulfillmentLocationId: string;
  /** Which of the two sales paths this listing is. */
  saleMode: SaleMode;
  targetQuantity: number;
  fundedQuantity: number;
  unitPriceAmount: MoneyString;
  currency: string;
  startAt: Date;
  /** NULL for a direct sale, which has no window. */
  endAt: Date | null;
  expectedPreparationDays: number;
  descriptionAr: string | null;
  descriptionEn: string | null;
  status: OpportunityStatus;
  firstActivatedAt: Date | null;
  extendedAt: Date | null;
  pausedAt: Date | null;
  pauseReason: string | null;
  cancelReason: string | null;
  reasonCode: string | null;
  reasonDetails: string | null;
  blockedAt: Date | null;
  fulfillmentCityNameAr: string | null;
  fulfillmentCityNameEn: string | null;
  fulfillmentRegionNameAr: string | null;
  fulfillmentRegionNameEn: string | null;
  taxRatePercent: string | null;
  unitPriceExclTaxAmount: MoneyString | null;
  unitTaxAmount: MoneyString | null;
  totalValueInclTaxAmount: MoneyString | null;
  sharePercentage: number | null;
  shareQuantity: number | null;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const ADMIN_SELECT = {
  id: true,
  companyId: true,
  productId: true,
  fulfillmentLocationId: true,
  saleMode: true,
  targetQuantity: true,
  fundedQuantity: true,
  unitPriceAmount: true,
  currency: true,
  startAt: true,
  endAt: true,
  expectedPreparationDays: true,
  descriptionAr: true,
  descriptionEn: true,
  status: true,
  firstActivatedAt: true,
  extendedAt: true,
  pausedAt: true,
  pauseReason: true,
  cancelReason: true,
  reasonCode: true,
  reasonDetails: true,
  blockedAt: true,
  fulfillmentCityNameAr: true,
  fulfillmentCityNameEn: true,
  fulfillmentRegionNameAr: true,
  fulfillmentRegionNameEn: true,
  taxRatePercent: true,
  unitPriceExclTaxAmount: true,
  unitTaxAmount: true,
  totalValueInclTaxAmount: true,
  shareBasisPoints: true,
  shareQuantity: true,
  salesUnitNameAr: true,
  salesUnitNameEn: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OpportunitySelect;

type AdminRow = Prisma.OpportunityGetPayload<{ select: typeof ADMIN_SELECT }>;

/**
 * Admin never selects fulfillmentLocationId's target row, city/region
 * internal ids, productApprovalSnapshotId, or shareTierPolicyVersionId
 * — this select list is the enforcement point, not just the response
 * mapper: those fields are never even fetched from the database here.
 * sharePercentage is derived from shareBasisPoints at mapping time —
 * the raw basis-points value itself is not part of AdminOpportunityView.
 */
function toAdminOpportunityView(row: AdminRow): AdminOpportunityView {
  return {
    id: row.id,
    companyId: row.companyId,
    productId: row.productId,
    fulfillmentLocationId: row.fulfillmentLocationId,
    saleMode: row.saleMode as SaleMode,
    targetQuantity: row.targetQuantity,
    fundedQuantity: row.fundedQuantity,
    unitPriceAmount: money(row.unitPriceAmount),
    currency: row.currency,
    startAt: row.startAt,
    endAt: row.endAt,
    expectedPreparationDays: row.expectedPreparationDays,
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    status: row.status,
    firstActivatedAt: row.firstActivatedAt,
    extendedAt: row.extendedAt,
    pausedAt: row.pausedAt,
    pauseReason: row.pauseReason,
    cancelReason: row.cancelReason,
    reasonCode: row.reasonCode,
    reasonDetails: row.reasonDetails,
    blockedAt: row.blockedAt,
    fulfillmentCityNameAr: row.fulfillmentCityNameAr,
    fulfillmentCityNameEn: row.fulfillmentCityNameEn,
    fulfillmentRegionNameAr: row.fulfillmentRegionNameAr,
    fulfillmentRegionNameEn: row.fulfillmentRegionNameEn,
    taxRatePercent: row.taxRatePercent === null ? null : row.taxRatePercent.toFixed(2),
    unitPriceExclTaxAmount: moneyOrNull(row.unitPriceExclTaxAmount),
    unitTaxAmount: moneyOrNull(row.unitTaxAmount),
    totalValueInclTaxAmount: moneyOrNull(row.totalValueInclTaxAmount),
    sharePercentage: row.shareBasisPoints !== null ? row.shareBasisPoints / 100 : null,
    shareQuantity: row.shareQuantity,
    salesUnitNameAr: row.salesUnitNameAr,
    salesUnitNameEn: row.salesUnitNameEn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Monitor-only, matching "Self-Service & Automation First": no
 * create/update method exists anywhere in this service. Price,
 * target quantity, share fields, and every snapshot are therefore
 * structurally unreachable from Admin — not merely blocked by a
 * check, there is simply no code path that could touch them.
 *
 * Every transition here is validated against the SAME
 * OPPORTUNITY_TRANSITIONS table opportunities.service.ts and the
 * lifecycle sweep already use — never a hand-picked status list.
 * ACTION_REQUIRED has no outgoing admin action at all: the table only
 * allows ACTION_REQUIRED -> SCHEDULED/ACTIVE, and that path is
 * exclusively the supplier's publish()/republish — Admin has no way
 * to "fix" a blocked opportunity on the supplier's behalf.
 */
@Injectable()
export class AdminOpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunitiesService
  ) {}

  async list(query: ListAdminOpportunitiesQueryDto): Promise<PaginatedResult<AdminOpportunityView>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.OpportunityWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.companyId) where.companyId = query.companyId;
    if (query.productId) where.productId = query.productId;

    const [rows, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        select: ADMIN_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    return { items: rows.map(toAdminOpportunityView), page, pageSize, total };
  }

  async getById(id: string): Promise<AdminOpportunityView> {
    const row = await this.prisma.opportunity.findUnique({ where: { id }, select: ADMIN_SELECT });
    if (!row) throw new NotFoundException("Opportunity not found");
    return toAdminOpportunityView(row);
  }

  /**
   * ACTIVE -> PAUSED, and only from ACTIVE (the only source listed
   * for PAUSED in the table). Reason is mandatory. Stops NEW sales
   * only — never touches fundedQuantity, never cancels or refunds
   * any already-paid order (see the file-level contract in
   * @platform/opportunity-lifecycle's sweep.ts, which this endpoint's
   * OPPORTUNITY_PAUSED event is bound by identically).
   *
   * The claim itself is a single atomic UPDATE ... WHERE status =
   * 'ACTIVE' ... RETURNING statement — never a SELECT-then-write. Two
   * concurrent pause() calls on the same row will have exactly one
   * UPDATE match (the other's WHERE clause finds nothing once the
   * first has committed its status change), so only one can ever
   * succeed, with no window for both to read "ACTIVE" before either
   * writes.
   */
  async pause(id: string, reason: string, ctx: ActorContext): Promise<AdminOpportunityView> {
    const existing = await this.requireExisting(id);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'PAUSED', paused_at = now(), pause_reason = ${reason}, updated_at = now()
        WHERE id = ${id}::uuid AND status = 'ACTIVE'
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "This opportunity is no longer ACTIVE and cannot be paused"
        );
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          companyId: existing.companyId,
          action: "OPPORTUNITY_PAUSED",
          entityType: "opportunity",
          entityId: id,
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "OPPORTUNITY_PAUSED", payload: { opportunityId: id } as Prisma.InputJsonValue },
      });

      const updated = await tx.opportunity.findUniqueOrThrow({ where: { id }, select: ADMIN_SELECT });
      return toAdminOpportunityView(updated);
    });
  }

  /**
   * PAUSED -> ACTIVE, and ONLY from PAUSED — the WHERE clause below
   * checks status = 'PAUSED' explicitly (never the generic "does
   * anything lead to ACTIVE" check, since DRAFT/SCHEDULED/
   * ACTION_REQUIRED -> ACTIVE via publish() and ACTIVE -> ACTIVE via
   * extend() are both unrelated to "resume").
   *
   * Self-corrects the temporal state first, atomically, inside the
   * same transaction: if end_at has already passed (the worker just
   * hasn't caught up to it yet), the atomic claim below is scoped to
   * `AND end_at > now()`, so a stale PAUSED row past its end date
   * simply fails to match — it is then transitioned to EXPIRED
   * (itself an atomic, WHERE-guarded claim) instead of being resumed,
   * exactly like OpportunitiesService.update() re-checks start_at
   * against "now" before allowing a SCHEDULED edit.
   */
  async resume(id: string, ctx: ActorContext): Promise<AdminOpportunityView> {
    const existing = await this.requireExisting(id);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const resumed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'ACTIVE', paused_at = NULL, pause_reason = NULL, updated_at = now()
        -- A DIRECT listing has no window: end_at is NULL on it, and a
        -- comparison against NULL is NULL, which would have made a
        -- paused direct listing impossible to resume and sent it to the
        -- expiry branch below instead — where it could not match
        -- either, leaving it stuck PAUSED for good.
        WHERE id = ${id}::uuid AND status = 'PAUSED'
          AND (end_at IS NULL OR end_at > now())
        RETURNING id
      `;

      if (resumed.length > 0) {
        await tx.auditLog.create({
          data: {
            actorType: AuditActorType.ADMIN,
            actorId: ctx.actorId,
            companyId: existing.companyId,
            action: "OPPORTUNITY_RESUMED",
            entityType: "opportunity",
            entityId: id,
            reason: existing.pauseReason ? `Previously paused for: ${existing.pauseReason}` : undefined,
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        await tx.outboxEvent.create({
          data: { eventType: "OPPORTUNITY_RESUMED", payload: { opportunityId: id } as Prisma.InputJsonValue },
        });
        return "RESUMED" as const;
      }

      // Not resumable as-is — atomically attempt the specific
      // self-correction: still PAUSED, but its end_at has passed.
      // This is a RETURN, deliberately not a throw: throwing inside
      // $transaction() rolls back everything in it, including this
      // EXPIRED write we explicitly want to keep — the caller-facing
      // error is raised separately, after this transaction commits.
      const expired = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'EXPIRED', updated_at = now()
        WHERE id = ${id}::uuid AND status = 'PAUSED' AND end_at <= now()
        RETURNING id
      `;
      if (expired.length > 0) {
        await tx.auditLog.create({
          data: {
            actorType: AuditActorType.SYSTEM,
            companyId: existing.companyId,
            action: "OPPORTUNITY_EXPIRED",
            entityType: "opportunity",
            entityId: id,
            reason: "Self-corrected on resume attempt: end_at had already passed",
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        await tx.outboxEvent.create({
          data: { eventType: "OPPORTUNITY_EXPIRED", payload: { opportunityId: id } as Prisma.InputJsonValue },
        });
        return "SELF_CORRECTED_TO_EXPIRED" as const;
      }

      // Neither claim matched — the row was not PAUSED at all (a
      // concurrent caller already changed it, or it never was).
      return "NOT_PAUSED" as const;
    });

    if (outcome === "SELF_CORRECTED_TO_EXPIRED") {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        "This opportunity has already ended and cannot be resumed — it has been marked EXPIRED"
      );
    }
    if (outcome === "NOT_PAUSED") {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "This opportunity is not PAUSED");
    }

    const updated = await this.prisma.opportunity.findUniqueOrThrow({ where: { id }, select: ADMIN_SELECT });
    return toAdminOpportunityView(updated);
  }

  /**
   * Reachable per the transitions table from DRAFT, SCHEDULED,
   * ACTIVE, or PAUSED — deliberately NOT from ACTION_REQUIRED (not in
   * the table), so Admin can never terminate a blocked opportunity as
   * a substitute for the supplier fixing and republishing it. Reason
   * is mandatory. Atomic claim: the UPDATE's WHERE clause re-checks
   * the transitions table for whichever status the row ACTUALLY has
   * at write time, via an explicit IN-list built from the table.
   *
   * Cancelling closes the opportunity to NEW sales permanently — it
   * never cancels or refunds any already-paid order and never
   * reverses fundedQuantity; any such order is handled exclusively
   * through its own independent order lifecycle (Phase 7).
   */
  async cancel(id: string, reason: string, ctx: ActorContext): Promise<AdminOpportunityView> {
    const existing = await this.requireExisting(id);

    // A PLAIN CANCEL LEAVES MONEY WHERE IT IS, so it may only be used
    // where there is none.
    //
    // «العرض منشور وليس عليه أي عمليات شراء — يقدر يلغيه… وإذا كان عليه
    //  عملية شراء يطلب المورد من الإدارة، الإدارة توقف العرض ويكون عندها
    //  زر استرداد الأموال.»
    //
    // WHAT IT USED TO DO. It set CANCELLED and released the LIVE locks —
    // sessions nobody had paid for. Anyone who HAD paid was untouched:
    // status cancelled, order still standing, buyer with neither goods
    // nor money. That is the last hole in the money path, and it is
    // closed by refusing rather than by silently refunding: an operator
    // must choose to give the money back, and `cancelAndRefund` is where
    // that choice is made.
    const paidOrders = await this.prisma.masterOrder.count({
      where: { opportunityId: id },
    });
    if (paidOrders > 0) {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        `Cannot cancel an opportunity that has been bought: ${paidOrders} paid order(s) stand on it. Use cancel-and-refund.`
      );
    }

    const cancellableFrom = (
      ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED"] as const
    ).filter((status) => isValidOpportunityTransition(status, "CANCELLED"));
    const cancellableFromSql = Prisma.join(cancellableFrom.map((s) => Prisma.sql`${s}::"OpportunityStatus"`));

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'CANCELLED', cancel_reason = ${reason}, updated_at = now()
        WHERE id = ${id}::uuid AND status IN (${cancellableFromSql})
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "This opportunity cannot be cancelled from its current status"
        );
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          companyId: existing.companyId,
          action: "OPPORTUNITY_CANCELLED",
          entityType: "opportunity",
          entityId: id,
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "OPPORTUNITY_CANCELLED", payload: { opportunityId: id } as Prisma.InputJsonValue },
      });

      await releaseActiveLocksForOpportunityTx(tx, id);

      const updated = await tx.opportunity.findUniqueOrThrow({ where: { id }, select: ADMIN_SELECT });
      return toAdminOpportunityView(updated);
    });
  }

/**
   * STOP THE OFFER AND GIVE THE MONEY BACK.
   *
   * «الإدارة توقف العرض ويكون عندها زر استرداد الأموال، عند الضغط يكون
   *  مثل أن فرصة انتهت ولم تكتمل — بس بدون ما هو آلي، يكون يدوي عن طريق
   *  الإدارة قبل أن تنتهي مدة العرض.»
   *
   * THE SAME PATH THE CLOCK TAKES, PRESSED BY HAND. One route for the
   * money and two triggers: the scheduler when a window closes without
   * filling, an administrator when something is wrong before then. Two
   * separate implementations would mean a buyer's refund depended on who
   * ended the offer.
   *
   * A REASON IS REQUIRED, unlike the product delete the owner asked to
   * be free of one. This is not an operator removing his own row — it is
   * a supplier's offer being stopped and buyers' money being moved, and
   * both of them will ask why.
   *
   * THE LIVE LOCKS GO TOO, exactly as a plain cancel does: a session
   * holding stock on an offer that no longer exists would keep that
   * stock out of everyone's reach for its whole lifetime.
   */
  async cancelAndRefund(
    id: string,
    reason: string,
    ctx: ActorContext
  ): Promise<AdminOpportunityView> {
    const existing = await this.requireExisting(id);

    /**
     * NOT FOR A DIRECT LISTING, and this is a guard about real money.
     *
     * The whole premise of this button is an offer whose buyers paid and
     * are WAITING: their goods were never prepared, because a group
     * offer holds every order in `AWAITING_FUNDING` until the target is
     * reached. Stopping such an offer strands them, so the money must go
     * back.
     *
     * A DIRECT SALE HAS NO WAITING BUYERS. Every paid order went to
     * preparation the moment it was paid — it is being packed, shipped,
     * disputed or settled on its own terms. Sweeping the listing would
     * write a refund obligation against every one of them, including
     * goods already delivered, in one press.
     *
     * WHAT TO DO INSTEAD, and it already exists: stop the listing (the
     * supplier's own `POST :id/stop`, or a plain `cancel` here), which
     * ends new sales and touches no order; and refund an individual
     * buyer through the dispute and refund path, where a decision is
     * made about one order by someone looking at it.
     */
    if (existing.saleMode === "DIRECT") {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        "A direct listing's paid orders are already in fulfilment — stop the listing and refund individual orders through the dispute path"
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // CANCELLABLE FROM THE SAME STATES A PLAIN CANCEL ALLOWS, read
      // from the shared transition table rather than listed again here.
      const cancellableFrom = (
        ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED"] as const
      ).filter((status) => isValidOpportunityTransition(status, "CANCELLED"));
      const cancellableFromSql = Prisma.join(
        cancellableFrom.map((state) => Prisma.sql`${state}::"OpportunityStatus"`)
      );

      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'CANCELLED',
            cancel_reason = ${reason},
            decision_window_closes_at = NULL,
            updated_at = now()
        WHERE id = ${id}::uuid AND status IN (${cancellableFromSql})
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "This opportunity cannot be cancelled from its current status"
        );
      }

      const refunded = await refundOfferPaymentsTx(
        tx,
        id,
        RefundObligationReasonCode.TARGET_NOT_REACHED
      );

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          companyId: existing.companyId,
          action: "OPPORTUNITY_CANCELLED_AND_REFUNDED",
          entityType: "opportunity",
          entityId: id,
          afterData: { refundedPayments: refunded } as Prisma.InputJsonValue,
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "OPPORTUNITY_CANCELLED_AND_REFUNDED",
          payload: { opportunityId: id, refundedPayments: refunded } as Prisma.InputJsonValue,
        },
      });

      await releaseActiveLocksForOpportunityTx(tx, id);

      const updated = await tx.opportunity.findUniqueOrThrow({
        where: { id },
        select: ADMIN_SELECT,
      });
      return toAdminOpportunityView(updated);
    });
  }

  /**
   * EDIT AN OFFER FROM THE CONSOLE — «حذف وتعديل العرض من صفحة
   * الإدارة، دام المشتري ما بعد دفع».
   *
   * IT DELEGATES RATHER THAN REIMPLEMENTS. Editing an offer
   * recomputes the tax, the share tier and the commission against
   * pinned policy versions and rewrites the snapshot in the same
   * transaction; a second copy of that here would be a second chance
   * to get it wrong. `OpportunitiesService` owns what a valid offer
   * is, and it is asked.
   *
   * WHAT THE ADMIN PATH SKIPS IS THE OWNERSHIP CHECK, and only
   * that: the supplier's own route reads the row through his
   * company, this one reads it directly. Every rule about what may
   * be changed — and the buyer's veto over all of them — is the
   * same function.
   */
  async update(
    id: string,
    dto: UpdateOpportunityDto,
    ctx: ActorContext
  ): Promise<AdminOpportunityView> {
    await this.opportunities.updateAsAdmin(id, dto, ctx);
    return this.getById(id);
  }

  /**
   * ERASE AN OFFER, ROW AND ALL.
   *
   * PAUSE, CANCEL AND DELETE ARE THREE DIFFERENT ANSWERS. Pausing
   * stops the sales and keeps the offer; cancelling ends it and
   * keeps the record; deleting says it should never have been there
   * — a duplicate, a test, a price typed with a zero too many — and
   * until now the console could not say it at all.
   *
   * THE PRODUCT IS NOT TOUCHED. An offer is an event on a product,
   * not the product itself, and the product has its own delete.
   *
   * THE AUDIT ENTRY IS WRITTEN BEFORE THE ROWS GO and carries the
   * offer's own identity — afterwards there is nothing left for an
   * entity id to join to.
   */
  async deletePermanently(
    id: string,
    reasonNote: string | undefined,
    ctx: ActorContext
  ): Promise<{ id: string; deleted: true }> {
    const existing = await this.prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, companyId: true, productId: true, status: true },
    });
    if (!existing) throw new NotFoundException("Opportunity not found");

    return this.prisma.$transaction(async (tx) => {
      await assertNoBuyerCommitted(tx, [id]);

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          companyId: existing.companyId,
          action: "OPPORTUNITY_DELETED",
          entityType: "opportunity",
          entityId: id,
          beforeData: {
            productId: existing.productId,
            status: existing.status,
          } as Prisma.InputJsonValue,
          reason: reasonNote ?? null,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "OPPORTUNITY_DELETED",
          payload: {
            opportunityId: id,
            companyId: existing.companyId,
          } as Prisma.InputJsonValue,
        },
      });

      await deleteOffersTx(tx, [id]);
      return { id, deleted: true as const };
    });
  }

  private async requireExisting(id: string) {
    const row = await this.prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, companyId: true, status: true, saleMode: true, pauseReason: true },
    });
    if (!row) throw new NotFoundException("Opportunity not found");
    return row;
  }
}
