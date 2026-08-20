import { Injectable, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
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
// Phase 7E — the dispute window is 7 calendar days from delivery,
// frozen once at the DELIVERED transition and never recomputed.
const DISPUTE_WINDOW_DAYS = 7;

@Injectable()
export class OrderAllocationService {
  constructor(private readonly prisma: PrismaService) {}

  async startPreparation(orderAllocationId: string, ctx: ActorContext) {
    await this.assertSupplierOwnership(orderAllocationId, ctx.companyId!);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE order_allocations SET status = 'PREPARING', preparation_started_at = now()
        WHERE id = ${orderAllocationId}::uuid AND status = 'AWAITING_PREPARATION'
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This allocation is not awaiting preparation");
      }
      await this.emit(tx, ctx, "ORDER_ALLOCATION_PREPARATION_STARTED", orderAllocationId);
      return tx.orderAllocation.findUniqueOrThrow({ where: { id: orderAllocationId } });
    });
  }

  async markReady(orderAllocationId: string, ctx: ActorContext) {
    await this.assertSupplierOwnership(orderAllocationId, ctx.companyId!);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE order_allocations SET status = 'READY_TO_SHIP', ready_to_ship_at = now()
        WHERE id = ${orderAllocationId}::uuid AND status = 'PREPARING'
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This allocation is not currently preparing");
      }
      await this.emit(tx, ctx, "ORDER_ALLOCATION_READY", orderAllocationId);
      return tx.orderAllocation.findUniqueOrThrow({ where: { id: orderAllocationId } });
    });
  }

  async ship(orderAllocationId: string, input: { carrierCode: string; trackingNumber: string }, ctx: ActorContext) {
    await this.assertSupplierOwnership(orderAllocationId, ctx.companyId!);
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
        UPDATE order_allocations SET status = 'SHIPPED', shipped_at = now()
        WHERE id = ${orderAllocationId}::uuid AND status = 'READY_TO_SHIP'
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This allocation is not ready to ship");
      }

      await tx.shipmentTracking.create({
        data: { orderAllocationId, carrierCode, trackingNumber, shippedByUserId: ctx.userId! },
      });

      await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_shipped_has_tracking IMMEDIATE`);

      await this.emit(tx, ctx, "ORDER_ALLOCATION_SHIPPED", orderAllocationId);
      return tx.orderAllocation.findUniqueOrThrow({ where: { id: orderAllocationId } });
    });
  }

  /**
   * Shared by all three delivery-confirmation paths (trader, admin,
   * carrier webhook). Lock order is fixed: MasterOrder FIRST (FOR
   * UPDATE), THEN the OrderAllocation claim — this serializes every
   * delivery confirmation for the SAME order, which is exactly what
   * guarantees FULFILLED is emitted exactly once even when the last
   * two allocations are delivered concurrently.
   */
  async confirmDeliveryTx(
    tx: Prisma.TransactionClient,
    orderAllocationId: string,
    confirmedAt: Date,
    source: "CARRIER_WEBHOOK" | "TRADER_CONFIRMATION" | "ADMIN_DECISION",
    extra: { confirmedByUserId?: string; carrierTrackingEventId?: string; adminReasonNote?: string },
    ctx: ActorContext
  ): Promise<{ claimed: boolean; masterOrderId: string }> {
    const preview = await tx.orderAllocation.findUniqueOrThrow({
      where: { id: orderAllocationId },
      select: { masterOrderId: true },
    });

    const orderRows = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM master_orders WHERE id = ${preview.masterOrderId}::uuid FOR UPDATE
    `;
    const masterOrderId = orderRows[0].id;

    const disputeWindowClosesAt = new Date(confirmedAt.getTime() + DISPUTE_WINDOW_DAYS * 86_400_000);
    const claimed = await tx.$queryRaw<{ id: string }[]>`
      UPDATE order_allocations SET status = 'DELIVERED', delivered_at = ${confirmedAt}, dispute_window_closes_at = ${disputeWindowClosesAt}
      WHERE id = ${orderAllocationId}::uuid AND status = 'SHIPPED'
      RETURNING id
    `;
    if (claimed.length === 0) {
      return { claimed: false, masterOrderId };
    }

    await tx.deliveryConfirmation.create({
      data: {
        orderAllocationId,
        confirmedBySource: source,
        confirmedAt,
        confirmedByUserId: extra.confirmedByUserId ?? null,
        carrierTrackingEventId: extra.carrierTrackingEventId ?? null,
        adminReasonNote: extra.adminReasonNote ?? null,
      },
    });

    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_delivered_has_confirmation IMMEDIATE`);

    await this.emit(tx, ctx, "ORDER_ALLOCATION_DELIVERED", orderAllocationId);

    const remaining = await tx.orderAllocation.count({
      where: { masterOrderId, status: { not: "DELIVERED" } },
    });
    if (remaining === 0) {
      const fulfilled = await tx.$queryRaw<{ id: string }[]>`
        UPDATE master_orders SET status = 'FULFILLED' WHERE id = ${masterOrderId}::uuid AND status = 'IN_FULFILLMENT' RETURNING id
      `;
      if (fulfilled.length > 0) {
        await this.emit(tx, ctx, "MASTER_ORDER_FULFILLED", masterOrderId, "master_order");
      }
    }

    return { claimed: true, masterOrderId };
  }

  async confirmDeliveryByTrader(orderAllocationId: string, ctx: ActorContext) {
    const allocation = await this.prisma.orderAllocation.findUnique({
      where: { id: orderAllocationId },
      include: { masterOrder: true },
    });
    if (!allocation) throw new NotFoundException("Order allocation not found");
    if (allocation.masterOrder.traderCompanyId !== ctx.companyId) {
      throw new ForbiddenException("This allocation does not belong to your company");
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.confirmDeliveryTx(tx, orderAllocationId, new Date(), "TRADER_CONFIRMATION", { confirmedByUserId: ctx.userId }, ctx);
      if (!result.claimed) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This allocation is not currently shipped");
      }
      return tx.orderAllocation.findUniqueOrThrow({ where: { id: orderAllocationId } });
    });
  }

  async confirmDeliveryByAdmin(orderAllocationId: string, reasonNote: string, ctx: ActorContext) {
    const allocation = await this.prisma.orderAllocation.findUnique({ where: { id: orderAllocationId } });
    if (!allocation) throw new NotFoundException("Order allocation not found");
    if (!reasonNote || reasonNote.trim().length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "reasonNote is required for an admin delivery decision");
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.confirmDeliveryTx(
        tx,
        orderAllocationId,
        new Date(),
        "ADMIN_DECISION",
        { confirmedByUserId: ctx.userId, adminReasonNote: reasonNote.trim() },
        ctx
      );
      if (!result.claimed) {
        throw new BusinessException(409, ERROR_CODES.INVALID_FULFILLMENT_TRANSITION, "This allocation is not currently shipped");
      }
      return tx.orderAllocation.findUniqueOrThrow({ where: { id: orderAllocationId } });
    });
  }

  private async assertSupplierOwnership(orderAllocationId: string, supplierCompanyId: string): Promise<void> {
    const allocation = await this.prisma.orderAllocation.findUnique({
      where: { id: orderAllocationId },
      include: { masterOrder: true },
    });
    if (!allocation) throw new NotFoundException("Order allocation not found");
    if (allocation.masterOrder.supplierCompanyId !== supplierCompanyId) {
      throw new ForbiddenException("This allocation does not belong to your company");
    }
  }

  private async emit(
    tx: Prisma.TransactionClient,
    ctx: ActorContext,
    action: string,
    entityId: string,
    entityType: "order_allocation" | "master_order" = "order_allocation"
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
      data: {
        eventType: action,
        payload: { [entityType === "master_order" ? "masterOrderId" : "orderAllocationId"]: entityId } as Prisma.InputJsonValue,
      },
    });
  }
}
