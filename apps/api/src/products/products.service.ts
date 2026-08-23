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
import type { ProductDetail, ProductSummary } from "@platform/types";
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
import type { CreateProductDto } from "./dto/create-product.dto";
import type { UpdateProductDto } from "./dto/update-product.dto";

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
   * The supplier's catalogue, as the closed `ProductSummary`.
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
  async listMine(companyId: string): Promise<ProductSummary[]> {
    const rows = await this.prisma.product.findMany({
      where: ownedProductWhere(companyId),
      select: PRODUCT_SUMMARY_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });

    return rows.map(toProductSummary);
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
  async assertEditableTx(_tx: Prisma.TransactionClient, product: Product): Promise<EditGuardResult> {
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

  private requirePackageContentGroupComplete(dto: {
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
  private requirePackageContentClearIsWholeGroup(dto: {
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

  private async requireActiveTaxonomyNode(id: string): Promise<void> {
    const node = await this.prisma.taxonomyNode.findUnique({ where: { id } });
    if (!node || !node.isActive) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or inactive taxonomy node");
    }
  }

  private async requireActiveSalesUnit(id: string): Promise<void> {
    const unit = await this.prisma.salesUnit.findUnique({ where: { id } });
    if (!unit || !unit.isActive) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or inactive sales unit");
    }
  }
}
