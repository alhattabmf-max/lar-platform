import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma, ProductApprovalStatus } from "@prisma/client";
import { isValidOpportunityTransition } from "@platform/domain";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { BusinessException } from "../../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { AdminPendingProductItem } from "@platform/types";
import { buildProductSnapshotPayload } from "../../products/product-snapshot.util";
import { releaseActiveLocksForOpportunityTx } from "../../checkout/checkout-lock-release.util";

interface ActorContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * Products waiting for review.
   *
   * A CLOSED projection. The previous read was
   * `include: { media: true, company: true }`, which shipped every
   * `ProductMedia` row — including `objectKey` and
   * `thumbnailObjectKey` — to the browser, plus the whole supplier
   * `Company` row. A storage key is a direct address in the object
   * store; handing one to a client turns a bucket path into a
   * credential, and an administrator is no exception to that.
   *
   * The queue needs to know whether images exist, not where they live:
   * `mediaCount` and `hasMainImage` answer that, and the images
   * themselves are viewed through the product's own authorised media
   * endpoint.
   */
  async listPendingReview(): Promise<AdminPendingProductItem[]> {
    const rows = await this.prisma.product.findMany({
      where: { approvalStatus: ProductApprovalStatus.PENDING_REVIEW },
      select: {
        id: true,
        companyId: true,
        nameAr: true,
        nameEn: true,
        taxonomyNodeId: true,
        createdAt: true,
        updatedAt: true,
        company: { select: { legalName: true } },
        _count: { select: { media: true } },
        // One row at most, and only its `isMain` flag: enough to answer
        // "has a main image been chosen" without selecting a key.
        media: { where: { isMain: true }, select: { id: true }, take: 1 },
      },
      // Oldest submission first, terminating in `id` so two products
      // submitted in the same millisecond cannot swap places.
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      companyLegalName: row.company.legalName,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      taxonomyNodeId: row.taxonomyNodeId,
      mediaCount: row._count.media,
      hasMainImage: row.media.length > 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async approve(productId: string, adminUserId: string, ctx: ActorContext) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { media: true },
    });
    if (!product || product.approvalStatus !== ProductApprovalStatus.PENDING_REVIEW) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Product is not pending review"
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { approvalStatus: ProductApprovalStatus.APPROVED, rejectionReason: null },
      });

      await tx.productApprovalSnapshot.create({
        data: {
          productId,
          approvalSource: "ADMIN",
          approvedByAdminId: adminUserId,
          snapshot: buildProductSnapshotPayload(product, product.media) as unknown as Prisma.InputJsonValue,
        },
      });
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminUserId,
      companyId: product.companyId,
      action: "PRODUCT_APPROVED",
      entityType: "product",
      entityId: productId,
      before: { approvalStatus: ProductApprovalStatus.PENDING_REVIEW },
      after: { approvalStatus: ProductApprovalStatus.APPROVED },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async reject(productId: string, reason: string, adminUserId: string, ctx: ActorContext) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.approvalStatus !== ProductApprovalStatus.PENDING_REVIEW) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Product is not pending review"
      );
    }

    await this.prisma.product.update({
      where: { id: productId },
      data: { approvalStatus: ProductApprovalStatus.REJECTED, rejectionReason: reason },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminUserId,
      companyId: product.companyId,
      action: "PRODUCT_REJECTED",
      entityType: "product",
      entityId: productId,
      before: { approvalStatus: ProductApprovalStatus.PENDING_REVIEW },
      after: { approvalStatus: ProductApprovalStatus.REJECTED },
      reason,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /**
   * APPROVED -> SUSPENDED only. Atomic claim on the product row itself
   * (UPDATE...WHERE...RETURNING) guarantees exactly one of two
   * concurrent admin decisions on the same product ever wins — the
   * loser's WHERE clause matches nothing once the winner has
   * committed, so it is rejected with zero writes, never a duplicate
   * cascade. The opportunity cascade below runs in the SAME
   * transaction as the product claim, so a product suspension and its
   * downstream opportunity effects are one atomic unit.
   *
   * Cascade (per the transitions table, never modified — see
   * packages/domain/src/opportunity-transitions.ts):
   * - DRAFT: no write — it already cannot be published while the
   *   product is not APPROVED (checked live at publish() time).
   * - ACTION_REQUIRED: no write — same reasoning; any future
   *   republish attempt is blocked by the same live eligibility check.
   * - SCHEDULED -> ACTION_REQUIRED (reasonCode=PRODUCT_SUSPENDED).
   * - ACTIVE -> PAUSED (stops new sales immediately).
   * - Already-paid orders are entirely untouched — there is no code
   *   path here that could reach one.
   */
  async suspend(productId: string, reasonNote: string, adminUserId: string, ctx: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string; company_id: string }[]>`
        UPDATE products
        SET approval_status = 'SUSPENDED', updated_at = now()
        WHERE id = ${productId}::uuid AND approval_status = 'APPROVED'
        RETURNING id, company_id
      `;
      if (claimed.length === 0) {
        const exists = await tx.product.findUnique({ where: { id: productId } });
        if (!exists) throw new NotFoundException("Product not found");
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          `Cannot suspend a product with status ${exists.approvalStatus}`
        );
      }
      const companyId = claimed[0].company_id;

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: adminUserId,
          companyId,
          action: "PRODUCT_SUSPENDED",
          entityType: "product",
          entityId: productId,
          beforeData: { approvalStatus: "APPROVED" },
          afterData: { approvalStatus: "SUSPENDED" },
          reason: reasonNote,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "PRODUCT_SUSPENDED", payload: { productId } as Prisma.InputJsonValue },
      });

      await this.cascadeToScheduled(tx, productId, "PRODUCT_SUSPENDED", ctx);
      await this.cascadeActiveToPaused(tx, productId, reasonNote, ctx);

      return tx.product.findUniqueOrThrow({ where: { id: productId } });
    });
  }

  /**
   * APPROVED or SUSPENDED -> CLOSED (permanent, never reversible).
   * Same atomic-claim + same-transaction-cascade shape as suspend().
   *
   * Cascade:
   * - DRAFT: no write (same reasoning as suspend()).
   * - ACTION_REQUIRED: deliberately left AS-IS — the transitions table
   *   has no ACTION_REQUIRED -> CANCELLED edge, and it is never
   *   modified silently to add one. Any future republish attempt is
   *   blocked by the live eligibility check (PRODUCT_CLOSED). This is
   *   the documented, consistent choice, not an oversight.
   * - SCHEDULED / ACTIVE / PAUSED -> CANCELLED (each already a legal
   *   edge in the table).
   */
  async close(productId: string, reasonNote: string, adminUserId: string, ctx: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string; company_id: string }[]>`
        UPDATE products
        SET approval_status = 'CLOSED', updated_at = now()
        WHERE id = ${productId}::uuid AND approval_status IN ('APPROVED', 'SUSPENDED')
        RETURNING id, company_id
      `;
      if (claimed.length === 0) {
        const exists = await tx.product.findUnique({ where: { id: productId } });
        if (!exists) throw new NotFoundException("Product not found");
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          `Cannot close a product with status ${exists.approvalStatus}`
        );
      }
      const companyId = claimed[0].company_id;

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: adminUserId,
          companyId,
          action: "PRODUCT_CLOSED",
          entityType: "product",
          entityId: productId,
          afterData: { approvalStatus: "CLOSED" },
          reason: reasonNote,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "PRODUCT_CLOSED", payload: { productId } as Prisma.InputJsonValue },
      });

      await this.cascadeToCancelled(tx, productId, reasonNote, ctx);

      return tx.product.findUniqueOrThrow({ where: { id: productId } });
    });
  }

  /**
   * SUSPENDED -> APPROVED only, and ONLY via this explicit admin
   * action — never automatic, not even when the supplier edits the
   * product (see ProductsService.assertEditableTx: editing a
   * SUSPENDED product never auto-reactivates it). Runs the same
   * technical checks as auto-approval and creates a new
   * ADMIN-sourced snapshot (this is a genuine human judgment call
   * overriding a report-driven suspension, not an automated pass).
   * CLOSED can never be reactivated (permanent) — not reachable here.
   */
  async reactivate(productId: string, adminUserId: string, ctx: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE products
        SET approval_status = 'APPROVED', updated_at = now()
        WHERE id = ${productId}::uuid AND approval_status = 'SUSPENDED'
        RETURNING id
      `;
      if (claimed.length === 0) {
        const exists = await tx.product.findUnique({ where: { id: productId } });
        if (!exists) throw new NotFoundException("Product not found");
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          `Cannot reactivate a product with status ${exists.approvalStatus}`
        );
      }

      const fresh = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      const media = await tx.productMedia.findMany({ where: { productId } });
      await tx.productApprovalSnapshot.create({
        data: {
          productId,
          approvalSource: "ADMIN",
          approvedByAdminId: adminUserId,
          snapshot: buildProductSnapshotPayload(fresh, media) as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: adminUserId,
          companyId: fresh.companyId,
          action: "PRODUCT_REACTIVATED",
          entityType: "product",
          entityId: productId,
          beforeData: { approvalStatus: "SUSPENDED" },
          afterData: { approvalStatus: "APPROVED" },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "PRODUCT_REACTIVATED", payload: { productId } as Prisma.InputJsonValue },
      });

      return fresh;
    });
  }

  /** SCHEDULED -> ACTION_REQUIRED for every opportunity on this product, atomically, no duplicate events even under concurrency. */
  private async cascadeToScheduled(
    tx: Prisma.TransactionClient,
    productId: string,
    reasonCode: string,
    ctx: ActorContext
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string; company_id: string }[]>`
      UPDATE opportunities
      SET status = 'ACTION_REQUIRED', reason_code = ${reasonCode}, reason_details = ${
        reasonCode === "PRODUCT_SUSPENDED"
          ? "This opportunity's product is temporarily suspended pending an administrative review."
          : "This opportunity's product has been permanently closed."
      }, blocked_at = now(), updated_at = now()
      WHERE product_id = ${productId}::uuid AND status = 'SCHEDULED'
      RETURNING id, company_id
    `;
    for (const row of rows) {
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          companyId: row.company_id,
          action: "OPPORTUNITY_ACTION_REQUIRED_PRODUCT_CASCADE",
          entityType: "opportunity",
          entityId: row.id,
          reason: reasonCode,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "OPPORTUNITY_ACTION_REQUIRED", payload: { opportunityId: row.id } as Prisma.InputJsonValue },
      });
    }
  }

  /** ACTIVE -> PAUSED for every opportunity on this product, atomically. */
  private async cascadeActiveToPaused(
    tx: Prisma.TransactionClient,
    productId: string,
    reasonNote: string,
    ctx: ActorContext
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string; company_id: string }[]>`
      UPDATE opportunities
      SET status = 'PAUSED', paused_at = now(), pause_reason = ${`Product suspended: ${reasonNote}`}, updated_at = now()
      WHERE product_id = ${productId}::uuid AND status = 'ACTIVE'
      RETURNING id, company_id
    `;
    for (const row of rows) {
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          companyId: row.company_id,
          action: "OPPORTUNITY_PAUSED_PRODUCT_CASCADE",
          entityType: "opportunity",
          entityId: row.id,
          reason: reasonNote,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "OPPORTUNITY_PAUSED", payload: { opportunityId: row.id } as Prisma.InputJsonValue },
      });
    }
  }

  /** SCHEDULED/ACTIVE/PAUSED -> CANCELLED for every opportunity on this product, atomically. ACTION_REQUIRED deliberately excluded (no such edge in the transitions table). */
  private async cascadeToCancelled(
    tx: Prisma.TransactionClient,
    productId: string,
    reasonNote: string,
    ctx: ActorContext
  ): Promise<void> {
    const cancellableFrom = (["SCHEDULED", "ACTIVE", "PAUSED"] as const).filter((s) =>
      isValidOpportunityTransition(s, "CANCELLED")
    );
    const cancellableFromSql = Prisma.join(cancellableFrom.map((s) => Prisma.sql`${s}::"OpportunityStatus"`));

    const rows = await tx.$queryRaw<{ id: string; company_id: string }[]>`
      UPDATE opportunities
      SET status = 'CANCELLED', cancel_reason = ${`Product closed: ${reasonNote}`}, updated_at = now()
      WHERE product_id = ${productId}::uuid AND status IN (${cancellableFromSql})
      RETURNING id, company_id
    `;
    for (const row of rows) {
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          companyId: row.company_id,
          action: "OPPORTUNITY_CANCELLED_PRODUCT_CASCADE",
          entityType: "opportunity",
          entityId: row.id,
          reason: reasonNote,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "OPPORTUNITY_CANCELLED", payload: { opportunityId: row.id } as Prisma.InputJsonValue },
      });
      await releaseActiveLocksForOpportunityTx(tx, row.id);
    }
  }
}
