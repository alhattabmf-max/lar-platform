import { Injectable, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { NotificationEventsService } from "../notifications/notification-events.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

interface ActorContext {
  userId?: string;
  companyId?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const TRACKING_NUMBER_MIN = 4;
const TRACKING_NUMBER_MAX = 64;

@Injectable()
export class ReplacementObligationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationEventsService
  ) {}

  async startPreparation(replacementObligationId: string, ctx: ActorContext) {
    await this.assertSupplierOwnership(replacementObligationId, ctx.companyId!);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE replacement_obligations SET status = 'PREPARING', preparation_started_at = now()
        WHERE id = ${replacementObligationId}::uuid AND status = 'AWAITING_PREPARATION'
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This replacement is not awaiting preparation");
      }
      await this.emit(tx, ctx, "REPLACEMENT_PREPARATION_STARTED", replacementObligationId);
      return tx.replacementObligation.findUniqueOrThrow({ where: { id: replacementObligationId } });
    });
  }

  async markReady(replacementObligationId: string, ctx: ActorContext) {
    await this.assertSupplierOwnership(replacementObligationId, ctx.companyId!);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE replacement_obligations SET status = 'READY_TO_SHIP', ready_to_ship_at = now()
        WHERE id = ${replacementObligationId}::uuid AND status = 'PREPARING'
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This replacement is not currently preparing");
      }
      await this.emit(tx, ctx, "REPLACEMENT_READY", replacementObligationId);
      return tx.replacementObligation.findUniqueOrThrow({ where: { id: replacementObligationId } });
    });
  }

  async ship(replacementObligationId: string, input: { carrierCode: string; trackingNumber: string }, ctx: ActorContext) {
    await this.assertSupplierOwnership(replacementObligationId, ctx.companyId!);
    const trackingNumber = input.trackingNumber.trim().toUpperCase();
    if (trackingNumber.length < TRACKING_NUMBER_MIN || trackingNumber.length > TRACKING_NUMBER_MAX) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "trackingNumber has an invalid length");
    }
    const carrierCode = input.carrierCode.trim();
    if (carrierCode.length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "carrierCode is required");
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE replacement_obligations SET status = 'SHIPPED', shipped_at = now()
        WHERE id = ${replacementObligationId}::uuid AND status = 'READY_TO_SHIP'
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This replacement is not ready to ship");
      }

      try {
        await tx.replacementShipmentTracking.create({
          data: { replacementObligationId, carrierCode, trackingNumber, shippedByUserId: ctx.userId! },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new BusinessException(409, ERROR_CODES.CONFLICT, "This carrierCode/trackingNumber pair has already been used");
        }
        throw err;
      }

      await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_replacement_shipped_has_tracking IMMEDIATE`);

      await this.emit(tx, ctx, "REPLACEMENT_SHIPPED", replacementObligationId);
      await this.notifications.replacementShipped(tx, replacementObligationId);
      return tx.replacementObligation.findUniqueOrThrow({ where: { id: replacementObligationId } });
    });
  }

  /**
   * Shared by all delivery-confirmation paths. Mandated lock order:
   * Dispute FOR UPDATE first, THEN ReplacementObligation FOR UPDATE —
   * this serializes delivery confirmation against mark-failed and
   * against the second admin decision, all of which touch the same
   * Dispute row.
   */
  async confirmDeliveryTx(
    tx: Prisma.TransactionClient,
    replacementObligationId: string,
    confirmedAt: Date,
    source: "CARRIER_WEBHOOK" | "TRADER_CONFIRMATION" | "ADMIN_DECISION",
    extra: { confirmedByUserId?: string; replacementCarrierTrackingEventId?: string; adminReasonNote?: string },
    ctx: ActorContext
  ): Promise<{ claimed: boolean; disputeId: string }> {
    const preview = await tx.replacementObligation.findUniqueOrThrow({
      where: { id: replacementObligationId },
      select: { disputeDecision: { select: { disputeId: true } } },
    });
    const disputeId = preview.disputeDecision.disputeId;

    const disputeRows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM disputes WHERE id = ${disputeId}::uuid FOR UPDATE`;
    if (disputeRows.length === 0) throw new NotFoundException("Dispute not found");

    const roRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM replacement_obligations WHERE id = ${replacementObligationId}::uuid FOR UPDATE
    `;
    if (roRows.length === 0) throw new NotFoundException("Replacement obligation not found");

    const claimed = await tx.$queryRaw<{ id: string }[]>`
      UPDATE replacement_obligations SET status = 'DELIVERED', delivered_at = ${confirmedAt}
      WHERE id = ${replacementObligationId}::uuid AND status = 'SHIPPED'
      RETURNING id
    `;
    if (claimed.length === 0) {
      return { claimed: false, disputeId };
    }

    await tx.replacementDeliveryConfirmation.create({
      data: {
        replacementObligationId,
        confirmedBySource: source,
        confirmedAt,
        confirmedByUserId: extra.confirmedByUserId ?? null,
        replacementCarrierTrackingEventId: extra.replacementCarrierTrackingEventId ?? null,
        adminReasonNote: extra.adminReasonNote ?? null,
      },
    });

    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_replacement_delivered_has_confirmation IMMEDIATE`);

    await this.emit(tx, ctx, "REPLACEMENT_DELIVERED", replacementObligationId);
    await this.notifications.replacementDelivered(tx, replacementObligationId);

    const closed = await tx.$queryRaw<{ id: string }[]>`
      UPDATE disputes SET status = 'RESOLVED_REPLACED' WHERE id = ${disputeId}::uuid AND status = 'AWAITING_REPLACEMENT' RETURNING id
    `;
    if (closed.length > 0) {
      await this.emit(tx, ctx, "DISPUTE_RESOLVED_REPLACED", disputeId, "dispute");
    }

    return { claimed: true, disputeId };
  }

  async confirmDeliveryByTrader(replacementObligationId: string, ctx: ActorContext) {
    const obligation = await this.prisma.replacementObligation.findUnique({
      where: { id: replacementObligationId },
      include: { disputeDecision: { include: { dispute: { include: { orderAllocation: { include: { masterOrder: true } } } } } } },
    });
    if (!obligation) throw new NotFoundException("Replacement obligation not found");
    if (obligation.disputeDecision.dispute.orderAllocation.masterOrder.traderCompanyId !== ctx.companyId) {
      throw new ForbiddenException("This replacement does not belong to your company");
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.confirmDeliveryTx(tx, replacementObligationId, new Date(), "TRADER_CONFIRMATION", { confirmedByUserId: ctx.userId }, ctx);
      if (!result.claimed) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This replacement is not currently shipped");
      }
      return tx.replacementObligation.findUniqueOrThrow({ where: { id: replacementObligationId } });
    });
  }

  async confirmDeliveryByAdmin(replacementObligationId: string, reasonNote: string, ctx: ActorContext) {
    const obligation = await this.prisma.replacementObligation.findUnique({ where: { id: replacementObligationId } });
    if (!obligation) throw new NotFoundException("Replacement obligation not found");
    if (!reasonNote || reasonNote.trim().length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "reasonNote is required for an admin delivery decision");
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.confirmDeliveryTx(
        tx,
        replacementObligationId,
        new Date(),
        "ADMIN_DECISION",
        { confirmedByUserId: ctx.userId, adminReasonNote: reasonNote.trim() },
        ctx
      );
      if (!result.claimed) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This replacement is not currently shipped");
      }
      return tx.replacementObligation.findUniqueOrThrow({ where: { id: replacementObligationId } });
    });
  }

  /**
   * Admin only. Same mandated lock order: Dispute first, then
   * ReplacementObligation — serializes against a concurrent delivery
   * confirmation racing to the same terminal transition.
   */
  async markFailed(replacementObligationId: string, ctx: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const preview = await tx.replacementObligation.findUniqueOrThrow({
        where: { id: replacementObligationId },
        select: { disputeDecision: { select: { disputeId: true } } },
      });
      const disputeId = preview.disputeDecision.disputeId;

      const disputeRows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM disputes WHERE id = ${disputeId}::uuid FOR UPDATE`;
      if (disputeRows.length === 0) throw new NotFoundException("Dispute not found");

      const roRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM replacement_obligations WHERE id = ${replacementObligationId}::uuid FOR UPDATE
      `;
      if (roRows.length === 0) throw new NotFoundException("Replacement obligation not found");

      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE replacement_obligations SET status = 'FAILED', failed_at = now()
        WHERE id = ${replacementObligationId}::uuid AND status IN ('AWAITING_PREPARATION', 'PREPARING', 'READY_TO_SHIP', 'SHIPPED')
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This replacement cannot be marked failed from its current state");
      }

      await this.emit(tx, ctx, "REPLACEMENT_FAILED", replacementObligationId);
      await this.notifications.replacementFailed(tx, replacementObligationId);

      return tx.replacementObligation.findUniqueOrThrow({ where: { id: replacementObligationId } });
    });
  }

  private async assertSupplierOwnership(replacementObligationId: string, supplierCompanyId: string): Promise<void> {
    const obligation = await this.prisma.replacementObligation.findUnique({
      where: { id: replacementObligationId },
      include: { disputeDecision: { include: { dispute: { include: { orderAllocation: { include: { masterOrder: true } } } } } } },
    });
    if (!obligation) throw new NotFoundException("Replacement obligation not found");
    if (obligation.disputeDecision.dispute.orderAllocation.masterOrder.supplierCompanyId !== supplierCompanyId) {
      throw new ForbiddenException("This replacement does not belong to your company");
    }
  }

  private async emit(
    tx: Prisma.TransactionClient,
    ctx: ActorContext,
    action: string,
    entityId: string,
    entityType: "replacement_obligation" | "dispute" = "replacement_obligation"
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorType: ctx.userId ? AuditActorType.USER : AuditActorType.SYSTEM,
        actorId: ctx.userId ?? null,
        companyId: ctx.companyId ?? null,
        action,
        entityType,
        entityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    await tx.outboxEvent.create({
      data: { eventType: action, payload: { entityType, entityId } as Prisma.InputJsonValue },
    });
  }
}
