import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma, ProductApprovalStatus } from "@prisma/client";
import { isValidOpportunityTransition } from "@platform/domain";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { BusinessException } from "../../common/errors/business-exception";
import { assertNoBuyerCommitted, deleteProductTx } from "../../common/removal";
import { ERROR_CODES } from "@platform/types";
import {
  ADMIN_PRODUCT_EDITABLE_FIELDS,
  adminProductMediaImagePath,
} from "@platform/types";
import type {
  AdminPendingProductItem,
  AdminProductDetail,
  AdminProductEditableField,
  ProductApprovalStatus as ProductApprovalStatusView,
} from "@platform/types";
import { buildProductSnapshotPayload } from "../../products/product-snapshot.util";
import { releaseActiveLocksForOpportunityTx } from "../../checkout/checkout-lock-release.util";
import { ProductsService } from "../../products/products.service";
import { MEDIA_ORDER } from "../../products/product.view";
import { AdminUpdateProductDto } from "./dto/admin-update-product.dto";

interface ActorContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * The review queue is drawn whole, and that is safe only while it is
 * bounded. Two hundred is a screenful of work many times over; a
 * backlog deeper than that is a staffing problem, not a paging one.
 */
const MAX_PENDING_REVIEW = 200;

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // THE SUPPLIER'S OWN WRITE RULES, called rather than restated. The
    // admin edit writes the same columns, so it must enforce the same
    // validity — and re-approve through the same path — or the platform
    // would hold two definitions of a valid product.
    private readonly products: ProductsService
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
        // One row at most, and only its `isMain` flag: enough to answer
        // "has a main image been chosen" without selecting a key.
        media: { where: { isMain: true }, select: { id: true }, take: 1 },
      },
      // Oldest submission first, terminating in `id` so two products
      // submitted in the same millisecond cannot swap places.
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      // A BOUNDED QUEUE.
      //
      // This is work waiting to be done, so it is normally short — but
      // "normally short" is an assumption about a table that grows, and
      // the one time it is wrong is a backlog, which is exactly when an
      // operator most needs the screen to open. The queue is worked
      // oldest-first, so the first two hundred ARE the next two hundred
      // decisions; nothing below that line is actionable before they
      // are.
      take: MAX_PENDING_REVIEW,
    });

    /**
     * THE IMAGE COUNTS, FOR THE QUEUE'S OWN ROWS ONLY.
     *
     * `_count: { media: true }` used to sit in the select above, and
     * Prisma compiles that into a LEFT JOIN against
     * `SELECT product_id, COUNT(*) FROM product_media GROUP BY
     * product_id` — the whole media table, aggregated before the
     * queue's own `take` is reached. The bound above would then have
     * been a bound on the ANSWER and not on the work.
     */
    const mediaCounts = new Map(
      rows.length === 0
        ? []
        : (
            await this.prisma.productMedia.groupBy({
              by: ["productId"],
              where: { productId: { in: rows.map((row) => row.id) } },
              _count: { _all: true },
            })
          ).map((row) => [row.productId, row._count._all] as const),
    );

    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      companyLegalName: row.company.legalName,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      taxonomyNodeId: row.taxonomyNodeId,
      mediaCount: mediaCounts.get(row.id) ?? 0,
      hasMainImage: row.media.length > 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /**
   * ONE PRODUCT, WHOLE — the read the console never had.
   *
   * The register lists products and the action routes change them; until
   * now nothing let an operator READ one. Everything a decision turns on
   * — what the thing is, what it weighs, what a package holds, what the
   * pictures show — existed only on the supplier's own screen, which an
   * administrator cannot open. Suspending a product from a name and a
   * status is not reviewing it.
   *
   * A CLOSED PROJECTION, like the queue above. No storage keys: the
   * media rows carry `objectKey`, and this returns delivery ROUTES built
   * from ids, served by the admin image controller that re-checks the
   * pairing on every request.
   *
   * `liveOfferCount` is here because it is what makes an edit
   * consequential — it is the exact count that refuses the SUPPLIER an
   * edit, and the screen states it before anyone types.
   */
  async getOne(productId: string): Promise<AdminProductDetail> {
    const row = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        companyId: true,
        nameAr: true,
        nameEn: true,
        descriptionAr: true,
        descriptionEn: true,
        approvalStatus: true,
        rejectionReason: true,
        archivedAt: true,
        taxonomyNodeId: true,
        salesUnitId: true,
        salesUnitNameAr: true,
        salesUnitNameEn: true,
        packageContentQuantity: true,
        packageContentUnitNameAr: true,
        packageContentUnitNameEn: true,
        weightPerUnit: true,
        lengthCm: true,
        widthCm: true,
        heightCm: true,
        createdAt: true,
        updatedAt: true,
        company: { select: { legalName: true } },
        // THE BRANCH AND ITS ANCESTORS, nested to the taxonomy's own
        // maximum depth (TAXONOMY_MAX_DEPTH = 3). A recursive walk would
        // be one query per level for a tree that cannot grow past three,
        // and a raw CTE would be a second definition of the hierarchy.
        taxonomyNode: {
          select: {
            nameAr: true,
            nameEn: true,
            parent: {
              select: {
                nameAr: true,
                nameEn: true,
                parent: { select: { nameAr: true, nameEn: true } },
              },
            },
          },
        },
        media: {
          // No `objectKey`, no `thumbnailObjectKey` — the same withholding
          // as the supplier projection.
          select: {
            id: true,
            contentType: true,
            sizeBytes: true,
            isMain: true,
            sortOrder: true,
          },
          orderBy: MEDIA_ORDER,
        },
        _count: {
          select: {
            opportunities: {
              where: { status: { in: [...ProductsService.OFFER_LOCKS_THE_PRODUCT] } },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException("Product not found");

    // Outermost first, so the path reads the way the market's own
    // navigation does.
    const ancestry = [row.taxonomyNode.parent?.parent, row.taxonomyNode.parent, row.taxonomyNode];
    const branch = ancestry.filter(
      (node): node is { nameAr: string; nameEn: string } => node != null
    );

    return {
      id: row.id,
      companyId: row.companyId,
      companyLegalName: row.company.legalName,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      descriptionAr: row.descriptionAr,
      descriptionEn: row.descriptionEn,
      approvalStatus: row.approvalStatus as ProductApprovalStatusView,
      rejectionReason: row.rejectionReason,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      taxonomyNodeId: row.taxonomyNodeId,
      taxonomyPathAr: branch.map((node) => node.nameAr),
      taxonomyPathEn: branch.map((node) => node.nameEn),
      salesUnitId: row.salesUnitId,
      salesUnitNameAr: row.salesUnitNameAr,
      salesUnitNameEn: row.salesUnitNameEn,
      // Physical measurements at their stored precision. Not money, but
      // decimal strings for the same reason: a float would change the value.
      packageContentQuantity: row.packageContentQuantity
        ? row.packageContentQuantity.toFixed(3)
        : null,
      packageContentUnitNameAr: row.packageContentUnitNameAr,
      packageContentUnitNameEn: row.packageContentUnitNameEn,
      weightPerUnit: row.weightPerUnit.toFixed(3),
      lengthCm: row.lengthCm.toFixed(2),
      widthCm: row.widthCm.toFixed(2),
      heightCm: row.heightCm.toFixed(2),
      media: row.media.map((media) => ({
        id: media.id,
        url: adminProductMediaImagePath(row.id, media.id, "main"),
        thumbnailUrl: adminProductMediaImagePath(row.id, media.id, "thumb"),
        contentType: media.contentType,
        sizeBytes: media.sizeBytes,
        isMain: media.isMain,
        sortOrder: media.sortOrder,
      })),
      liveOfferCount: row._count.opportunities,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * AN ADMINISTRATOR EDITING A SUPPLIER'S PRODUCT.
   *
   * «تعديل بصلاحية كاملة، مسجَّل في التدقيق باسم المشرف وقيمه قبل وبعد.»
   *
   * WHAT IT DOES NOT ENFORCE, and why. The supplier's own edit is
   * refused outright while a buyer can reach the product — see
   * `ProductsService.assertEditableTx` — and also while it is archived,
   * pending review, or permanently closed. NONE of those refusals apply
   * here, and that is the whole point of the permission: they exist to
   * stop a SELLER changing what they are selling underneath a buyer,
   * and support exists precisely for the cases the seller cannot fix.
   *
   * A LIVE OFFER IS NOT CHANGED BY THIS, and that is a fact about the
   * platform rather than a promise made here. A published offer is built
   * from its own frozen `ProductApprovalSnapshot` and renders from it —
   * `toPublicView` reads the snapshot, never the product row — so a
   * buyer looking at an offer today sees exactly what they saw
   * yesterday. What an edit changes is the product record and every
   * offer published from it AFTER the edit.
   *
   * WHAT IT STILL ENFORCES, because these are not permissions but
   * validity: the branch must be active and a leaf, the sales unit must
   * be active, and the package-content group is all-or-nothing. The
   * rules are `ProductsService`'s own, called rather than restated.
   *
   * RE-APPROVAL RUNS EXACTLY AS IT DOES FOR THE SUPPLIER. If the product
   * is APPROVED, the technical checks re-run against the edited row
   * inside the same transaction and a fresh AUTO snapshot is written; if
   * they fail, the ENTIRE edit is refused. An administrator must not be
   * able to leave an approved product in a state the platform would not
   * have approved.
   *
   * NOTHING WRITTEN, NOTHING RECORDED. A save that changes no value
   * returns the row untouched and writes no audit entry — a log full of
   * empty edits is a log nobody reads.
   */
  async updateAsAdmin(
    productId: string,
    dto: AdminUpdateProductDto,
    adminUserId: string,
    ctx: ActorContext
  ) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException("Product not found");

    const { reason, ...fields } = dto;

    if (fields.taxonomyNodeId) await this.products.requireActiveTaxonomyNode(fields.taxonomyNodeId);
    // `null` clears the soft reference and must NOT be looked up.
    if (fields.salesUnitId) await this.products.requireActiveSalesUnit(fields.salesUnitId);

    // Refused before the transaction opens, so a mixed clear writes
    // nothing at all.
    this.products.requirePackageContentClearIsWholeGroup(fields);

    // The MERGED state, resolving all three intents: `undefined` keeps
    // what the row has, `null` removes it, a value sets it.
    const merged = <T>(sent: T | null | undefined, current: T | null | undefined) =>
      sent === undefined ? (current ?? undefined) : (sent ?? undefined);

    this.products.requirePackageContentGroupComplete({
      packageContentQuantity: merged(
        fields.packageContentQuantity,
        product.packageContentQuantity?.toNumber()
      ),
      packageContentUnitNameAr: merged(
        fields.packageContentUnitNameAr,
        product.packageContentUnitNameAr
      ),
      packageContentUnitNameEn: merged(
        fields.packageContentUnitNameEn,
        product.packageContentUnitNameEn
      ),
    });

    // WHAT THE ROW HOLDS NOW, in the shape the DTO sends. Decimals are
    // compared as numbers because that is what arrives over the wire;
    // comparing a `Decimal` object to a `number` would report every
    // numeric field as changed on every save.
    const current: Record<AdminProductEditableField, unknown> = {
      taxonomyNodeId: product.taxonomyNodeId,
      salesUnitId: product.salesUnitId,
      salesUnitNameAr: product.salesUnitNameAr,
      salesUnitNameEn: product.salesUnitNameEn,
      packageContentQuantity: product.packageContentQuantity
        ? product.packageContentQuantity.toNumber()
        : null,
      packageContentUnitNameAr: product.packageContentUnitNameAr,
      packageContentUnitNameEn: product.packageContentUnitNameEn,
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      descriptionAr: product.descriptionAr,
      descriptionEn: product.descriptionEn,
      weightPerUnit: product.weightPerUnit.toNumber(),
      lengthCm: product.lengthCm.toNumber(),
      widthCm: product.widthCm.toNumber(),
      heightCm: product.heightCm.toNumber(),
    };

    const sent = fields as Record<string, unknown>;
    const before: Record<string, Prisma.JsonValue> = {};
    const after: Record<string, Prisma.JsonValue> = {};
    for (const field of ADMIN_PRODUCT_EDITABLE_FIELDS) {
      const value = sent[field];
      // Omitted means "leave it alone" — not "set it to nothing".
      if (value === undefined) continue;
      if (Object.is(current[field], value)) continue;
      before[field] = (current[field] ?? null) as Prisma.JsonValue;
      after[field] = (value ?? null) as Prisma.JsonValue;
    }

    if (Object.keys(after).length === 0) return product;

    const { result } = await this.prisma.$transaction(async (tx) => {
      // Every field passes through UNCHANGED, which is what makes the
      // three intents work: Prisma reads `undefined` as "leave this
      // column alone" and `null` as "set it to null".
      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          taxonomyNodeId: fields.taxonomyNodeId,
          salesUnitId: fields.salesUnitId,
          salesUnitNameAr: fields.salesUnitNameAr,
          salesUnitNameEn: fields.salesUnitNameEn,
          packageContentQuantity: fields.packageContentQuantity,
          packageContentUnitNameAr: fields.packageContentUnitNameAr,
          packageContentUnitNameEn: fields.packageContentUnitNameEn,
          nameAr: fields.nameAr,
          nameEn: fields.nameEn,
          descriptionAr: fields.descriptionAr,
          descriptionEn: fields.descriptionEn,
          weightPerUnit: fields.weightPerUnit,
          lengthCm: fields.lengthCm,
          widthCm: fields.widthCm,
          heightCm: fields.heightCm,
        },
      });

      const reapproved = await this.products.reapproveIfNeededTx(
        tx,
        productId,
        product.approvalStatus === ProductApprovalStatus.APPROVED
      );

      // IN THE SAME TRANSACTION as the write it records. An edit that
      // commits without its audit entry is an unattributed change to
      // somebody else's record, which is the one thing this permission
      // must never be allowed to produce.
      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: adminUserId,
          companyId: product.companyId,
          action: "PRODUCT_EDITED_BY_ADMIN",
          entityType: "product",
          entityId: productId,
          before,
          after,
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx
      );

      if (reapproved) {
        await this.audit.log(
          {
            actorType: AuditActorType.SYSTEM,
            companyId: product.companyId,
            action: "PRODUCT_AUTO_REAPPROVED_ON_EDIT",
            entityType: "product",
            entityId: productId,
            reason:
              "Product data changed by an administrator — technical checks passed, new AUTO snapshot created",
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
          tx
        );
      }

      return { result: updated };
    });

    return result;
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
/**
   * ERASE A PRODUCT, ROW AND ALL — «طلبت أني أقدر أحذف المنتج نهائيًّا
   * ولا لقيت إلا خيار إغلاق».
   *
   * CLOSING AND DELETING ARE DIFFERENT ANSWERS TO DIFFERENT QUESTIONS.
   * Closing says "this is no longer for sale" and keeps every record of
   * what it was, which is the only correct answer once anyone has
   * bought from it. Deleting says "this never belonged here" — a
   * duplicate, a test, a mistake — and there was no way to say it.
   *
   * AND IT REFUSES WHERE MONEY CHANGED HANDS — «دام المشتري ما بعد
   * دفع». A master order and a paid checkout session both point AT an
   * opportunity; erase the opportunity and the order names a thing
   * that is not there. An invoice that cannot say what was invoiced is
   * worse than a listing that stays visible, so a product somebody
   * BOUGHT from is CLOSED and never deleted.
   *
   * AN ABANDONED BASKET IS NOT THAT, and it used to be treated as if
   * it were. The rule now lives in `assertNoBuyerCommitted`, once, for this
   * door and the three others the owner asked for.
   *
   * THE AUDIT ENTRY IS WRITTEN BEFORE THE ROWS GO, and it carries the
   * product's own identity in `beforeData` — after this transaction
   * there is nothing left for an entity id to join to, so the log has
   * to hold the evidence itself rather than a pointer to it.
   */
  async deletePermanently(
    productId: string,
    /**
     * OPTIONAL — «بدون أن يطلب مني سبب لذلك».
     *
     * Every other administrative action here demands a written reason,
     * and for a suspension or a rejection that is right: somebody else
     * reads it later. A delete is the owner removing his own row, and
     * the audit entry still records WHO, WHEN and WHAT — the product's
     * name, its status and how many offers went with it. Only the WHY
     * is now his to leave blank.
     */
    reasonNote: string | undefined,
    adminUserId: string,
    ctx: ActorContext
  ) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException("Product not found");

      const offers = await tx.opportunity.findMany({
        where: { productId },
        select: { id: true },
      });

      // THE OWNER'S ONE CONDITION, ASKED THE ONE WAY — «نفّذها
      // الأربعة دام المشتري ما بعد دفع». The supplier's own delete,
      // his offer's delete and the console's delete of either all ask
      // `assertNoBuyerCommitted`, so an operator and a supplier can never be
      // told different things about the same product.
      //
      // IT USED TO REFUSE ON ANY CHECKOUT SESSION, abandoned ones
      // included, and that was not caution — it was a guess about what
      // the database would allow. It allows more now: a snapshot no
      // offer reads, and an allocation no order was built on, both
      // delete. What no rule will ever release is a row an invoice and
      // a ledger entry stand on.
      //
      // ASKED INSIDE THE TRANSACTION THAT DELETES, so a caller who
      // skips the console meets the same answer, and a payment landing
      // mid-delete is not missed.
      await assertNoBuyerCommitted(
        tx,
        offers.map((offer) => offer.id)
      );

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: adminUserId,
          companyId: product.companyId,
          action: "PRODUCT_DELETED",
          entityType: "product",
          entityId: productId,
          beforeData: {
            nameAr: product.nameAr,
            nameEn: product.nameEn,
            approvalStatus: product.approvalStatus,
            offerCount: offers.length,
          } as Prisma.InputJsonValue,
          reason: reasonNote ?? null,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "PRODUCT_DELETED",
          payload: { productId, companyId: product.companyId } as Prisma.InputJsonValue,
        },
      });

      // EVERYTHING THAT HUNG OFF IT, in the one place that knows the
      // order — the same routine the supplier's own delete runs.
      const removed = await deleteProductTx(tx, productId);

      return { id: productId, deleted: true, offersDeleted: removed.offersDeleted };
    });
  }

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
