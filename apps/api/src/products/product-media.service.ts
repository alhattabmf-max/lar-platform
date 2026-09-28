import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AuditActorType, ProductApprovalStatus, type Product } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { MediaPolicyService } from "../settings/media-policy.service";
import { ProductsService } from "./products.service";
import { processImage, InvalidImageError } from "../common/media/image-processing.util";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/** An administrator has no company of their own. */
interface AdminActorContext {
  adminUserId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * WHO IS CHANGING THE PICTURES, and what that entitles them to.
 *
 * The four media operations are identical whoever performs them — the
 * same processing, the same storage keys, the same orphan cleanup, the
 * same re-approval. TWO things differ, and both are here rather than in
 * four duplicated method bodies:
 *
 *   `supplierLock` — the refusal that stops a SELLER changing what a
 *     buyer can already see. An administrator is exempt for the same
 *     reason they are exempt on the fields: support exists precisely
 *     for the cases the seller cannot fix, and a published offer
 *     renders from its own frozen snapshot either way.
 *
 *   `actorType` / `actorId` — whose name goes in the audit log, and
 *     whether the action reads as the supplier's or the console's.
 */
interface Who {
  actorType: AuditActorType;
  actorId: string;
  /** The PRODUCT's company. An audit row is filed under the record it touches. */
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  supplierLock: boolean;
}

const supplierWho = (ctx: ActorContext): Who => ({
  actorType: AuditActorType.USER,
  actorId: ctx.userId,
  companyId: ctx.companyId,
  requestId: ctx.requestId,
  ipAddress: ctx.ipAddress,
  userAgent: ctx.userAgent,
  supplierLock: true,
});

const adminWho = (companyId: string, ctx: AdminActorContext): Who => ({
  actorType: AuditActorType.ADMIN,
  actorId: ctx.adminUserId,
  companyId,
  requestId: ctx.requestId,
  ipAddress: ctx.ipAddress,
  userAgent: ctx.userAgent,
  supplierLock: false,
});

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

@Injectable()
export class ProductMediaService {
  private readonly logger = new Logger(ProductMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly mediaPolicy: MediaPolicyService,
    private readonly products: ProductsService
  ) {}

  /**
   * THE PRODUCT, WITHOUT AN OWNERSHIP CLAUSE.
   *
   * For the console only, and the boundary moves rather than
   * disappears: the supplier path resolves through
   * `getOwnedProduct`, which filters by the session's company; the
   * admin routes are gated by the admin session guard instead, and
   * an administrator has no company to filter by.
   */
  private async getAnyProduct(productId: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  /**
   * What this actor is allowed to change, and whether the product
   * must be re-approved afterwards.
   *
   * A SUPPLIER goes through `assertEditableTx`, which refuses
   * outright while a buyer can reach the product — and also while it
   * is archived, pending review or permanently closed.
   *
   * AN ADMINISTRATOR is refused none of those; what survives is the
   * consequence, which is the same for both: an APPROVED product
   * whose pictures changed must pass the technical checks again and
   * carry a fresh snapshot, or the whole change is rejected.
   */
  private async guardTx(
    tx: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
    product: Product,
    who: Who
  ): Promise<boolean> {
    if (who.supplierLock) {
      const guard = await this.products.assertEditableTx(tx, product);
      return guard.requiresReapproval;
    }
    return product.approvalStatus === ProductApprovalStatus.APPROVED;
  }

  async upload(productId: string, buffer: Buffer, ctx: ActorContext) {
    const product = await this.products.getOwnedProduct(productId, ctx.companyId);
    return this.uploadFor(product, buffer, supplierWho(ctx));
  }

  async uploadAsAdmin(productId: string, buffer: Buffer, ctx: AdminActorContext) {
    const product = await this.getAnyProduct(productId);
    return this.uploadFor(product, buffer, adminWho(product.companyId, ctx));
  }

  private async uploadFor(product: Product, buffer: Buffer, who: Who) {
    const productId = product.id;
    const policy = await this.mediaPolicy.getPolicy();

    const currentCount = await this.prisma.productMedia.count({ where: { productId } });
    if (currentCount >= policy.maxImagesPerProduct) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `This product already has the maximum of ${policy.maxImagesPerProduct} images`
      );
    }
    if (buffer.length > policy.maxSizeBytes) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Image exceeds the maximum allowed size of ${policy.maxSizeBytes} bytes`
      );
    }

    let processed;
    try {
      processed = await processImage(buffer, policy);
    } catch (err) {
      if (err instanceof InvalidImageError) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, err.message);
      }
      throw err;
    }

    const ext = EXTENSION_BY_CONTENT_TYPE[processed.contentType] ?? "bin";
    const baseKey = `products/${productId}/${randomUUID()}`;
    const objectKey = `${baseKey}.${ext}`;
    const thumbnailObjectKey = `${baseKey}-thumb.${ext}`;

    // Storage and Postgres are two separate systems — there is no real
    // cross-system transaction. Upload first, then commit the DB row;
    // if the DB step fails, best-effort delete what was just uploaded
    // so it doesn't linger as an orphan no row ever points to.
    await this.storage.upload(objectKey, processed.mainBuffer, processed.contentType);
    await this.storage.upload(thumbnailObjectKey, processed.thumbnailBuffer, processed.contentType);

    try {
      const { media, reapproved } = await this.prisma.$transaction(async (tx) => {
        const requiresReapproval = await this.guardTx(tx, product, who);
        const media = await tx.productMedia.create({
          data: {
            productId,
            objectKey,
            thumbnailObjectKey,
            contentType: processed.contentType,
            sizeBytes: buffer.length,
            isMain: currentCount === 0,
            sortOrder: currentCount,
          },
        });
        const reapproved = await this.products.reapproveIfNeededTx(tx, productId, requiresReapproval);
        return { media, reapproved };
      });

      await this.auditMutation(productId, who, reapproved, "PRODUCT_MEDIA_UPLOADED");
      return media;
    } catch (err) {
      await this.bestEffortDelete(objectKey);
      await this.bestEffortDelete(thumbnailObjectKey);
      throw err;
    }
  }

  async remove(productId: string, mediaId: string, ctx: ActorContext): Promise<void> {
    const product = await this.products.getOwnedProduct(productId, ctx.companyId);
    return this.removeFor(product, mediaId, supplierWho(ctx));
  }

  async removeAsAdmin(
    productId: string,
    mediaId: string,
    ctx: AdminActorContext
  ): Promise<void> {
    const product = await this.getAnyProduct(productId);
    return this.removeFor(product, mediaId, adminWho(product.companyId, ctx));
  }

  private async removeFor(product: Product, mediaId: string, who: Who): Promise<void> {
    const productId = product.id;
    const media = await this.prisma.productMedia.findFirst({ where: { id: mediaId, productId } });
    if (!media) throw new NotFoundException("Product media not found");

    // DB reference is removed FIRST and is authoritative the moment
    // this transaction commits — a subsequent Storage-delete failure
    // only ever leaves an orphaned object in Storage (cleaned up
    // later), never a DB row pointing at nothing.
    const { reapproved } = await this.prisma.$transaction(async (tx) => {
      const requiresReapproval = await this.guardTx(tx, product, who);
      await tx.productMedia.delete({ where: { id: mediaId } });

      if (media.isMain) {
        const next = await tx.productMedia.findFirst({
          where: { productId },
          orderBy: { sortOrder: "asc" },
        });
        if (next) {
          await tx.productMedia.update({ where: { id: next.id }, data: { isMain: true } });
        }
      }
      const reapproved = await this.products.reapproveIfNeededTx(tx, productId, requiresReapproval);
      return { reapproved };
    });

    await this.bestEffortDelete(media.objectKey);
    await this.bestEffortDelete(media.thumbnailObjectKey);

    await this.auditMutation(productId, who, reapproved, "PRODUCT_MEDIA_REMOVED");
  }

  async setMain(productId: string, mediaId: string, ctx: ActorContext): Promise<void> {
    const product = await this.products.getOwnedProduct(productId, ctx.companyId);
    return this.setMainFor(product, mediaId, supplierWho(ctx));
  }

  async setMainAsAdmin(
    productId: string,
    mediaId: string,
    ctx: AdminActorContext
  ): Promise<void> {
    const product = await this.getAnyProduct(productId);
    return this.setMainFor(product, mediaId, adminWho(product.companyId, ctx));
  }

  private async setMainFor(product: Product, mediaId: string, who: Who): Promise<void> {
    const productId = product.id;
    const media = await this.prisma.productMedia.findFirst({ where: { id: mediaId, productId } });
    if (!media) throw new NotFoundException("Product media not found");

    const reapproved = await this.prisma.$transaction(async (tx) => {
      const requiresReapproval = await this.guardTx(tx, product, who);
      await tx.productMedia.updateMany({ where: { productId }, data: { isMain: false } });
      await tx.productMedia.update({ where: { id: mediaId }, data: { isMain: true } });
      return this.products.reapproveIfNeededTx(tx, productId, requiresReapproval);
    });

    await this.auditMutation(productId, who, reapproved, "PRODUCT_MEDIA_MAIN_CHANGED");
  }

  async reorder(productId: string, mediaIds: string[], ctx: ActorContext): Promise<void> {
    const product = await this.products.getOwnedProduct(productId, ctx.companyId);
    return this.reorderFor(product, mediaIds, supplierWho(ctx));
  }

  async reorderAsAdmin(
    productId: string,
    mediaIds: string[],
    ctx: AdminActorContext
  ): Promise<void> {
    const product = await this.getAnyProduct(productId);
    return this.reorderFor(product, mediaIds, adminWho(product.companyId, ctx));
  }

  private async reorderFor(product: Product, mediaIds: string[], who: Who): Promise<void> {
    const productId = product.id;
    const existing = await this.prisma.productMedia.findMany({ where: { productId } });

    // TRUE set equality, checked in both directions.
    //
    // The previous guard compared lengths and membership only, which
    // `[a, a]` satisfies when the product holds `[a, b]`: same length,
    // every id known. The loop below then wrote `a.sortOrder = 0` and
    // `a.sortOrder = 1` while `b` kept a stale order — a partial reorder
    // that reported success. `@ArrayUnique` on the DTO rejects the
    // duplicate first; this is the second lock, so the invariant does
    // not depend on a decorator staying attached.
    const existingIds = new Set(existing.map((m) => m.id));
    const submittedIds = new Set(mediaIds);
    const sameSet =
      submittedIds.size === mediaIds.length &&
      submittedIds.size === existingIds.size &&
      mediaIds.every((id) => existingIds.has(id));
    if (!sameSet) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "reorder must include exactly the product's current media ids, each once"
      );
    }

    const reapproved = await this.prisma.$transaction(async (tx) => {
      const requiresReapproval = await this.guardTx(tx, product, who);
      for (let i = 0; i < mediaIds.length; i++) {
        await tx.productMedia.update({ where: { id: mediaIds[i] }, data: { sortOrder: i } });
      }
      return this.products.reapproveIfNeededTx(tx, productId, requiresReapproval);
    });

    await this.auditMutation(productId, who, reapproved, "PRODUCT_MEDIA_REORDERED");
  }

  /**
   * WHO CHANGED THE PICTURES, AND WHETHER THE PLATFORM RE-APPROVED.
   *
   * The action carries the actor in its NAME when it is the console —
   * `PRODUCT_MEDIA_REMOVED_BY_ADMIN` — because the audit register is
   * filtered by action, and «who removed a supplier's photograph»
   * should be answerable without reading every row's actor column.
   */
  private async auditMutation(
    productId: string,
    who: Who,
    reapproved: boolean,
    action: string
  ): Promise<void> {
    const named =
      who.actorType === AuditActorType.ADMIN ? `${action}_BY_ADMIN` : action;
    if (reapproved) {
      await this.audit.log({
        actorType: AuditActorType.SYSTEM,
        companyId: who.companyId,
        action: "PRODUCT_AUTO_REAPPROVED_ON_EDIT",
        entityType: "product",
        entityId: productId,
        reason: "Product media changed after approval — technical checks passed, new AUTO snapshot created",
        requestId: who.requestId,
        ipAddress: who.ipAddress,
        userAgent: who.userAgent,
      });
    }

    await this.audit.log({
      actorType: who.actorType,
      actorId: who.actorId,
      companyId: who.companyId,
      action: named,
      entityType: "product",
      entityId: productId,
      requestId: who.requestId,
      ipAddress: who.ipAddress,
      userAgent: who.userAgent,
    });
  }

  private async bestEffortDelete(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch (err) {
      this.logger.error(
        `Failed to delete storage object "${objectKey}" — left as an orphan for later cleanup: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
    }
  }
}
