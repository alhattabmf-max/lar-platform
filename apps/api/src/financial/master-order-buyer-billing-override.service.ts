import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

interface AdminActorContext {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class MasterOrderBuyerBillingOverrideService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async createOverride(masterOrderId: string, reasonNote: string, ctx: AdminActorContext) {
    const trimmedReason = reasonNote?.trim() ?? "";
    if (trimmedReason.length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "reasonNote is required");
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.masterOrder.findUnique({ where: { id: masterOrderId } });
      if (!order) throw new NotFoundException("Master order not found");

      if (order.traderTaxProfileSnapshot !== null) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This order already has a frozen buyer billing snapshot — no override is needed or allowed");
      }

      const existingOverride = await tx.masterOrderBuyerBillingOverride.findUnique({ where: { masterOrderId } });
      if (existingOverride) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A buyer billing override already exists for this order");
      }

      const traderTaxProfile = await tx.traderTaxProfile.findUnique({ where: { companyId: order.traderCompanyId } });
      if (!traderTaxProfile) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "The trader has not completed their tax profile yet — cannot create an override");
      }

      const snapshotOverride = {
        isVatRegistered: traderTaxProfile.isVatRegistered,
        vatNumber: traderTaxProfile.vatNumber,
        billingLegalName: traderTaxProfile.billingLegalName,
      };

      const override = await tx.masterOrderBuyerBillingOverride.create({
        data: {
          masterOrderId,
          traderTaxProfileSnapshotOverride: snapshotOverride as Prisma.InputJsonValue,
          createdByAdminUserId: ctx.userId,
          reasonNote: trimmedReason,
        },
      });

      await this.audit.log({
        // ADMIN, not USER. There is no company-facing route to this
        // service anywhere in the API — its only caller is
        // `AdminBuyerBillingOverrideController`. Recording it as a USER
        // action hides it from anyone filtering the audit log for what
        // an administrator did.
        actorType: AuditActorType.ADMIN,
        actorId: ctx.userId,
        action: "MASTER_ORDER_BUYER_BILLING_OVERRIDE_CREATED",
        entityType: "master_order_buyer_billing_override",
        entityId: override.id,
        after: { masterOrderId, hasVatNumber: traderTaxProfile.vatNumber !== null },
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return override;
    });
  }
}
