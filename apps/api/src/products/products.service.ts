import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AccountType,
  AuditActorType,
  CompanyVerificationStatus,
  Prisma,
  ProductApprovalStatus,
  type Product,
} from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import type { Paginated, ProductDetail, ProductSummary } from "@platform/types";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@platform/types";
import type { ListMyProductsQueryDto } from "./dto/list-my-products.dto";
import {
  PRODUCT_DETAIL_SELECT,
  PRODUCT_SUMMARY_SELECT,
  ownedProductWhere,
  toProductDetail,
  toProductSummary,
} from "./product.view";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { runProductTechnicalChecks } from "./product-technical-checks";
import { buildProductSnapshotPayload } from "./product-snapshot.util";
import { assertNoBuyerCommitted, deleteProductTx } from "../common/removal";
import type { CreateProductDto } from "./dto/create-product.dto";
import type { UpdateProductDto } from "./dto/update-product.dto";

/**
 * THE CATALOGUE IS PAGED, AND THE CEILING IS GONE.
 *
 * It used to end at `MAX_OWN_CATALOGUE = 500` — the most recent five
 * hundred — with a note saying a real supplier reaching it would need a
 * pager and a searchable picker rather than a larger number. One did,
 * in measurement: at the limit this screen was 6.4 MB of HTML and 1.1
 * seconds, and a supplier past it never saw their oldest products at
 * all. A ceiling answers wrongly and says nothing.
 *
 * What bounds the response now is the PAGE, and `MAX_PAGE_SIZE` bounds
 * the page — so a caller asking for a thousand is served a hundred,
 * and the reply is the same size whether the supplier has fifty
 * products or fifty thousand.
 *
 * ATTENTION FIRST is still the screen's rule, and it is now a filter
 * rather than a split made in the browser: under a pager, half a page
 * is not half a catalogue.
 */
const ATTENTION_STATUSES = [
  ProductApprovalStatus.DRAFT,
  ProductApprovalStatus.REJECTED,
  ProductApprovalStatus.SUSPENDED,
] as const;

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Result of the shared editability guard. requiresReapproval tells
 * the caller (this service's own update(), and ProductMediaService's
 * mutations) whether they must call reapproveIfNeededTx() AFTER their
 * own edit completes, inside the SAME transaction — since technical
 * checks (e.g. "has a main image") can only be evaluated correctly
 * once the actual edit has already happened.
 */
interface EditGuardResult {
  requiresReapproval: boolean;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * The supplier's catalogue, one page of it, as the closed
   * `ProductSummary`.
   *
   * This used to be `include: { media: true }` on a raw Prisma row, so every
   * response carried each image's `objectKey` and `thumbnailObjectKey` — the
   * internal storage addresses — alongside Decimal instances that serialise
   * as JSON numbers. `PRODUCT_SUMMARY_SELECT` and `toProductSummary` were
   * written in 8E.2 and wired to `getOwned` only; the list was missed.
   *
   * Ownership is IN THE QUERY. Ordering terminates in the primary key: two
   * products created in the same millisecond must not swap places between
   * requests.
   */
  async listMine(
    companyId: string,
    query: ListMyProductsQueryDto = {}
  ): Promise<Paginated<ProductSummary>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
    const search = query.search?.trim();

    const where: Prisma.ProductWhereInput = {
      ...ownedProductWhere(companyId),
      // THE NAME, IN EITHER LANGUAGE. A supplier who named a product in
      // English and searches in Arabic finds nothing, and that is
      // correct; a supplier who does not remember which language they
      // used finds it either way.
      ...(search
        ? {
            OR: [
              { nameAr: { contains: search, mode: "insensitive" as const } },
              { nameEn: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(query.needsAttention === undefined
        ? {}
        : query.needsAttention
          ? { approvalStatus: { in: [...ATTENTION_STATUSES] } }
          : { approvalStatus: { notIn: [...ATTENTION_STATUSES] } }),
      // Publishable is APPROVED AND UNARCHIVED, which is the pair the
      // listing form was checking in the browser after being handed the
      // whole catalogue.
      ...(query.publishable
        ? { approvalStatus: ProductApprovalStatus.APPROVED, archivedAt: null }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: PRODUCT_SUMMARY_SELECT,
        // Terminating in the primary key: two products created in the
        // same millisecond must not swap places between pages, which is
        // how a pager serves one row twice and another never.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items: rows.map(toProductSummary), page, pageSize, total };
  }

  /**
   * One of the supplier's own products.
   *
   * Ownership is IN THE QUERY, so an unknown id and another company's product
   * answer with the same 404 — nothing distinguishable by probing.
   *
   * Returns the closed `ProductDetail`: no approval snapshots, and no media
   * storage keys. Images are addressed by the delivery route, which re-checks
   * ownership itself on every request.
   */
  async getOwned(id: string, companyId: string): Promise<ProductDetail> {
    const row = await this.prisma.product.findFirst({
      where: { id, ...ownedProductWhere(companyId) },
      select: PRODUCT_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException("Product not found");

    return toProductDetail(row);
  }

  async getOwnedProduct(id: string, companyId: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({ where: { id, companyId } });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  async create(dto: CreateProductDto, ctx: ActorContext) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    if (company.accountType !== AccountType.SUPPLIER) {
      throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "Only supplier accounts can create products");
    }

    await this.requireActiveTaxonomyNode(dto.taxonomyNodeId);
    if (dto.salesUnitId) await this.requireActiveSalesUnit(dto.salesUnitId);
    this.requirePackageContentGroupComplete(dto);

    const product = await this.prisma.product.create({
      data: {
        companyId: ctx.companyId,
        taxonomyNodeId: dto.taxonomyNodeId,
        // salesUnitId is a soft UI-suggestion reference only — never
        // read by business logic. salesUnitNameAr/En are the real
        // source of truth, always required.
        salesUnitId: dto.salesUnitId,
        salesUnitNameAr: dto.salesUnitNameAr,
        salesUnitNameEn: dto.salesUnitNameEn,
        packageContentQuantity: dto.packageContentQuantity,
        packageContentUnitNameAr: dto.packageContentUnitNameAr,
        packageContentUnitNameEn: dto.packageContentUnitNameEn,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        descriptionAr: dto.descriptionAr,
        descriptionEn: dto.descriptionEn,
        weightPerUnit: dto.weightPerUnit,
        lengthCm: dto.lengthCm,
        widthCm: dto.widthCm,
        heightCm: dto.heightCm,
      },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "PRODUCT_CREATED",
      entityType: "product",
      entityId: product.id,
      after: { nameAr: product.nameAr, nameEn: product.nameEn },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return product;
  }

  async update(id: string, dto: UpdateProductDto, ctx: ActorContext) {
    const product = await this.getOwnedProduct(id, ctx.companyId);

    if (dto.taxonomyNodeId) await this.requireActiveTaxonomyNode(dto.taxonomyNodeId);
    // `null` clears the soft reference and must NOT be looked up.
    if (dto.salesUnitId) await this.requireActiveSalesUnit(dto.salesUnitId);

    // Refused before the transaction opens, so a mixed clear writes
    // nothing at all.
    this.requirePackageContentClearIsWholeGroup(dto);

    // The MERGED state, resolving all three intents:
    //   `undefined` -> keep what the row has
    //   `null`      -> gone
    //   a value     -> that value
    // `??` alone cannot express this, because it treats null and
    // undefined identically — which is exactly the distinction here.
    const merged = <T>(sent: T | null | undefined, current: T | null | undefined) =>
      sent === undefined ? (current ?? undefined) : (sent ?? undefined);

    this.requirePackageContentGroupComplete({
      packageContentQuantity: merged(
        dto.packageContentQuantity,
        product.packageContentQuantity?.toNumber()
      ),
      packageContentUnitNameAr: merged(dto.packageContentUnitNameAr, product.packageContentUnitNameAr),
      packageContentUnitNameEn: merged(dto.packageContentUnitNameEn, product.packageContentUnitNameEn),
    });

    const { result, reapproved } = await this.prisma.$transaction(async (tx) => {
      const guard = await this.assertEditableTx(tx, product);
      // Every field is passed through UNCHANGED, which is what makes the
      // three intents work: Prisma reads `undefined` as "leave this
      // column alone" and `null` as "set it to null". Coercing with `??`
      // anywhere here would collapse the two and make clearing
      // impossible — which is exactly the state this replaces.
      const updated = await tx.product.update({
        where: { id },
        data: {
          taxonomyNodeId: dto.taxonomyNodeId,
          salesUnitId: dto.salesUnitId,
          salesUnitNameAr: dto.salesUnitNameAr,
          salesUnitNameEn: dto.salesUnitNameEn,
          packageContentQuantity: dto.packageContentQuantity,
          packageContentUnitNameAr: dto.packageContentUnitNameAr,
          packageContentUnitNameEn: dto.packageContentUnitNameEn,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          descriptionAr: dto.descriptionAr,
          descriptionEn: dto.descriptionEn,
          weightPerUnit: dto.weightPerUnit,
          lengthCm: dto.lengthCm,
          widthCm: dto.widthCm,
          heightCm: dto.heightCm,
        },
      });
      const reapproved = await this.reapproveIfNeededTx(tx, id, guard.requiresReapproval);
      return { result: updated, reapproved };
    });

    if (reapproved) {
      await this.audit.log({
        actorType: AuditActorType.SYSTEM,
        companyId: ctx.companyId,
        action: "PRODUCT_AUTO_REAPPROVED_ON_EDIT",
        entityType: "product",
        entityId: id,
        reason: "Product data changed after approval — technical checks passed, new AUTO snapshot created",
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "PRODUCT_UPDATED",
      entityType: "product",
      entityId: id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return result;
  }

  /**
   * Runs the technical checks and, on success, auto-approves —
   * creating a new AUTO ProductApprovalSnapshot and setting APPROVED.
   * Auto-approval does NOT depend on any routine admin review; it is
   * gated exclusively by runProductTechnicalChecks(). Only reachable
   * from DRAFT or REJECTED. On failure, throws a 400 listing every
   * failed check and writes NOTHING — the product stays exactly as it
   * was for the supplier to correct and resubmit.
   */
  async submit(id: string, ctx: ActorContext) {
    const product = await this.getOwnedProduct(id, ctx.companyId);

    if (product.archivedAt) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Product is archived");
    }
    if (
      product.approvalStatus !== ProductApprovalStatus.DRAFT &&
      product.approvalStatus !== ProductApprovalStatus.REJECTED
    ) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Cannot submit a product from status ${product.approvalStatus}`
      );
    }

    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    if (company.verificationStatus !== CompanyVerificationStatus.VERIFIED) {
      throw new BusinessException(
        403,
        ERROR_CODES.SUPPLIER_NOT_VERIFIED,
        "Your company must be a verified supplier before submitting products"
      );
    }

    const media = await this.prisma.productMedia.findMany({ where: { productId: id } });
    const errors = runProductTechnicalChecks({
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      salesUnitNameAr: product.salesUnitNameAr,
      salesUnitNameEn: product.salesUnitNameEn,
      packageContentQuantity: product.packageContentQuantity?.toNumber() ?? null,
      packageContentUnitNameAr: product.packageContentUnitNameAr,
      packageContentUnitNameEn: product.packageContentUnitNameEn,
      weightPerUnit: product.weightPerUnit.toNumber(),
      lengthCm: product.lengthCm.toNumber(),
      widthCm: product.widthCm.toNumber(),
      heightCm: product.heightCm.toNumber(),
      hasMainImage: media.some((m) => m.isMain),
    });
    if (errors.length > 0) {
      // The CODES, never the sentences they used to be. `message` stays a
      // fixed developer-facing string with nothing interpolated into it,
      // so no check detail can reach a response through it either.
      throw new BusinessException(
        400,
        ERROR_CODES.PRODUCT_TECHNICAL_CHECK_FAILED,
        "Product cannot be auto-approved yet",
        { failedChecks: errors }
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.product.update({
        where: { id },
        data: { approvalStatus: ProductApprovalStatus.APPROVED, rejectionReason: null },
      });
      await tx.productApprovalSnapshot.create({
        data: {
          productId: id,
          approvalSource: "AUTO",
          approvedByAdminId: null,
          snapshot: buildProductSnapshotPayload(result, media) as unknown as Prisma.InputJsonValue,
        },
      });
      return result;
    });

    await this.audit.log({
      actorType: AuditActorType.SYSTEM,
      companyId: ctx.companyId,
      action: "PRODUCT_AUTO_APPROVED",
      entityType: "product",
      entityId: id,
      before: { approvalStatus: product.approvalStatus },
      after: { approvalStatus: ProductApprovalStatus.APPROVED },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  /**
   * THE SUPPLIER DELETES HIS OWN PRODUCT — «المنتج يُحذف من صفحة
   * المورّد ومن صفحة الإدارة، دام المشتري ما بعد دفع».
   *
   * HE HAD NO SUCH DOOR. What he had was `archive`, which is one
   * way: the row stays in his catalogue for ever, with no edit, no
   * offer and no way back — there is no unarchive. Two of his
   * products ended up exactly there, and neither the console nor his
   * own page could clear them.
   *
   * ARCHIVE STAYS, and it is a different answer: «خلّني أوقفه» rather
   * than «امسحه». The screen offers both.
   *
   * IT WORKS ON AN ARCHIVED PRODUCT TOO, deliberately — that is the
   * way out of the dead end, and refusing there would leave the two
   * rows that started this stuck for the same reason a second time.
   *
   * THE SAME RULE THE CONSOLE USES, from the same function, and it
   * is asked INSIDE the transaction that deletes so a payment landing
   * mid-delete is not missed.
   *
   * THE AUDIT ENTRY IS WRITTEN BEFORE THE ROWS GO and carries the
   * product's own identity: after this transaction there is nothing
   * left for an entity id to join to, so the log holds the evidence
   * rather than a pointer to it.
   */
  async remove(id: string, ctx: ActorContext) {
    const product = await this.getOwnedProduct(id, ctx.companyId);

    return this.prisma.$transaction(async (tx) => {
      const offers = await tx.opportunity.findMany({
        where: { productId: id },
        select: { id: true },
      });

      await assertNoBuyerCommitted(
        tx,
        offers.map((offer) => offer.id)
      );

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action: "PRODUCT_DELETED",
          entityType: "product",
          entityId: id,
          beforeData: {
            nameAr: product.nameAr,
            nameEn: product.nameEn,
            approvalStatus: product.approvalStatus,
            offerCount: offers.length,
          } as Prisma.InputJsonValue,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "PRODUCT_DELETED",
          payload: { productId: id, companyId: ctx.companyId } as Prisma.InputJsonValue,
        },
      });

      const removed = await deleteProductTx(tx, id);
      return { id, deleted: true, offersDeleted: removed.offersDeleted };
    });
  }

  async archive(id: string, ctx: ActorContext) {
    const product = await this.getOwnedProduct(id, ctx.companyId);

    if (product.archivedAt) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Product is already archived");
    }
    if (product.approvalStatus === ProductApprovalStatus.PENDING_REVIEW) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Cannot archive a product while it is pending review"
      );
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { archivedAt: new Date() },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "PRODUCT_ARCHIVED",
      entityType: "product",
      entityId: id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  /**
   * Shared editability guard used both by update() above and by
   * ProductMediaService's upload/delete/set-main/reorder mutations.
   * Must run inside the SAME transaction as the actual edit.
   *
   * - archived / PENDING_REVIEW (legacy safety, unreachable via the
   *   normal flow now) / CLOSED: reject outright.
   * - SUSPENDED: edit is allowed (the supplier may submit a
   *   correction) but NEVER auto-reactivates — reactivation is an
   *   explicit, separate administrative decision only.
   * - APPROVED: edit is allowed; requiresReapproval=true tells the
   *   caller to run reapproveIfNeededTx() AFTER their own mutation.
   * - DRAFT/REJECTED: edit freely, no snapshot logic at all.
   */
  /**
   * A PUBLISHED PRODUCT IS NOT THE SUPPLIER'S TO EDIT ANY MORE.
   *
   * «بعدها يقدر يعدل عليه أو يسوي له نشر؛ إذا نشره خلاص ما يقدر يعدل
   *  عليه. لكن لو كان فيه خطأ في البيانات بعد النشر لازم الإدارة تتدخل.»
   *
   * WHAT IT USED TO DO. An APPROVED product returned
   * `requiresReapproval: true` — edit freely, and a fresh approval
   * snapshot is written afterwards. So a supplier could change the name,
   * the weight and the dimensions of a product WITH A LIVE OFFER AND
   * BUYERS ON IT. The running offer still pointed at the OLD snapshot,
   * so it went on selling specifications the row no longer held.
   *
   * THE LOCK IS THE OFFER, NOT THE APPROVAL. A product approved and
   * never published is a draft in every sense that matters and stays
   * editable. What closes it is a buyer being able to see it.
   *
   * AND IT OPENS AGAIN. «الإدارة توقف العرض… ويرجع المورد ينشر عرض ثاني
   * بعد ما يصحح المشكلة» — once every offer is cancelled or expired,
   * nobody is reading it and the supplier may correct and publish anew.
   * A permanent lock would make one mistake permanent too.
   *
   * FUNDED KEEPS IT SHUT. Buyers are waiting for goods described by that
   * offer, and its own screen is what they read while they wait.
   */
  static readonly OFFER_LOCKS_THE_PRODUCT = [
    "SCHEDULED",
    "ACTIVE",
    "PAUSED",
    "FUNDED",
  ] as const;

  async assertEditableTx(tx: Prisma.TransactionClient, product: Product): Promise<EditGuardResult> {
    const liveOffers = await tx.opportunity.count({
      where: {
        productId: product.id,
        status: { in: [...ProductsService.OFFER_LOCKS_THE_PRODUCT] },
      },
    });
    if (liveOffers > 0) {
      throw new BusinessException(
        409,
        ERROR_CODES.PRODUCT_HAS_LIVE_OFFER,
        `Cannot edit a product a buyer can reach: ${liveOffers} published offer(s) stand on it`
      );
    }

    if (product.archivedAt) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Product is archived");
    }
    if (product.approvalStatus === ProductApprovalStatus.PENDING_REVIEW) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Cannot modify a product while it is pending review"
      );
    }
    if (product.approvalStatus === ProductApprovalStatus.CLOSED) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "This product is permanently closed and cannot be modified");
    }
    if (product.approvalStatus === ProductApprovalStatus.SUSPENDED) {
      return { requiresReapproval: false };
    }
    if (product.approvalStatus === ProductApprovalStatus.APPROVED) {
      return { requiresReapproval: true };
    }
    return { requiresReapproval: false };
  }

  /**
   * Called AFTER the caller's own edit (product field change, or a
   * media mutation) completes, inside the SAME transaction. Re-reads
   * the CURRENT product+media state, runs technical checks against
   * it, and — on success — creates a new AUTO snapshot (product stays
   * APPROVED). On failure, the ENTIRE transaction (including the
   * caller's edit) is rejected — a product is never left half-edited
   * with a stale approval.
   */
  async reapproveIfNeededTx(tx: Prisma.TransactionClient, productId: string, requiresReapproval: boolean): Promise<boolean> {
    if (!requiresReapproval) return false;

    const fresh = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const media = await tx.productMedia.findMany({ where: { productId } });

    const errors = runProductTechnicalChecks({
      nameAr: fresh.nameAr,
      nameEn: fresh.nameEn,
      salesUnitNameAr: fresh.salesUnitNameAr,
      salesUnitNameEn: fresh.salesUnitNameEn,
      packageContentQuantity: fresh.packageContentQuantity?.toNumber() ?? null,
      packageContentUnitNameAr: fresh.packageContentUnitNameAr,
      packageContentUnitNameEn: fresh.packageContentUnitNameEn,
      weightPerUnit: fresh.weightPerUnit.toNumber(),
      lengthCm: fresh.lengthCm.toNumber(),
      widthCm: fresh.widthCm.toNumber(),
      heightCm: fresh.heightCm.toNumber(),
      hasMainImage: media.some((m) => m.isMain),
    });
    if (errors.length > 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.PRODUCT_TECHNICAL_CHECK_FAILED,
        "This change would leave the approved product technically incomplete",
        { failedChecks: errors }
      );
    }

    await tx.productApprovalSnapshot.create({
      data: {
        productId,
        approvalSource: "AUTO",
        approvedByAdminId: null,
        snapshot: buildProductSnapshotPayload(fresh, media) as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  }

  requirePackageContentGroupComplete(dto: {
    packageContentQuantity?: number | null;
    packageContentUnitNameAr?: string | null;
    packageContentUnitNameEn?: string | null;
  }): void {
    const provided = [dto.packageContentQuantity, dto.packageContentUnitNameAr, dto.packageContentUnitNameEn].filter(
      (v) => v !== undefined && v !== null
    ).length;
    if (provided !== 0 && provided !== 3) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "packageContentQuantity, packageContentUnitNameAr, and packageContentUnitNameEn must all be provided together, or not at all"
      );
    }
  }

  /**
   * The package-content trio clears as a UNIT.
   *
   * A supplier removing the group sends all three as `null`. Any mix —
   * one null beside two values, or two nulls beside one value — is
   * refused BEFORE the transaction opens, because a quantity with no unit
   * is not a package description, it is a half-erased one.
   *
   * Checked separately from `requirePackageContentGroupComplete`, which
   * looks at the MERGED result: this one looks only at what the request
   * said, and is the only place that can see the difference between
   * "omitted" and "explicitly null".
   */
  requirePackageContentClearIsWholeGroup(dto: {
    packageContentQuantity?: number | null;
    packageContentUnitNameAr?: string | null;
    packageContentUnitNameEn?: string | null;
  }): void {
    const group = [
      dto.packageContentQuantity,
      dto.packageContentUnitNameAr,
      dto.packageContentUnitNameEn,
    ];

    const nulls = group.filter((v) => v === null).length;
    if (nulls === 0 || nulls === 3) return;

    throw new BusinessException(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "packageContentQuantity, packageContentUnitNameAr, and packageContentUnitNameEn must be cleared together — send all three as null, or none of them"
    );
  }

  /**
   * The node must exist, be active, and be a LEAF.
   *
   * The leaf rule is the owner's: «التصنيف إجباري، واختيار الفرع
   * إجباري إذا كان للتصنيف فروع». A node with active children is a
   * signpost rather than a shelf, and the supplier is the one who knows
   * which branch is right — so the answer is refused here rather than
   * guessed.
   *
   * IT LIVES HERE, not in the form, because every write path reaches
   * this one method. A rule enforced in a component is a rule the next
   * component forgets, and the API would have accepted what the form
   * refused. `TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS` records the decision
   * for the surfaces that have to describe it.
   *
   * Only ACTIVE children count. A parent whose children were all
   * deactivated is a leaf again — refusing it would leave a category
   * nothing could be filed under at all.
   */
  /**
   * SHARED WITH THE ADMIN EDIT, which is why these four are not private.
   *
   * `AdminProductsService.updateAsAdmin` writes the same columns and must
   * therefore enforce the same rules: an inactive branch, a branch that is
   * not a LEAF, an inactive sales unit, and the package-content group that
   * is all-or-nothing. Restating any of them there would give the platform
   * two definitions of a valid product, free to drift — and the one that
   * drifts would be the one an administrator uses to "fix" a row.
   */
  async requireActiveTaxonomyNode(id: string): Promise<void> {
    const node = await this.prisma.taxonomyNode.findUnique({
      where: { id },
      include: { _count: { select: { children: { where: { isActive: true } } } } },
    });
    if (!node || !node.isActive) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or inactive taxonomy node");
    }
    if (node._count.children > 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "TAXONOMY_BRANCH_REQUIRED"
      );
    }
  }

  async requireActiveSalesUnit(id: string): Promise<void> {
    const unit = await this.prisma.salesUnit.findUnique({ where: { id } });
    if (!unit || !unit.isActive) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or inactive sales unit");
    }
  }
}
