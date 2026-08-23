import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AuditActorType } from "@prisma/client";
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

  async upload(productId: string, buffer: Buffer, ctx: ActorContext) {
    const product = await this.products.getOwnedProduct(productId, ctx.companyId);
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
        const guard = await this.products.assertEditableTx(tx, product);
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
        const reapproved = await this.products.reapproveIfNeededTx(tx, productId, guard.requiresReapproval);
        return { media, reapproved };
      });

      await this.auditMutation(productId, ctx, reapproved, "PRODUCT_MEDIA_UPLOADED");
      return media;
    } catch (err) {
      await this.bestEffortDelete(objectKey);
      await this.bestEffortDelete(thumbnailObjectKey);
      throw err;
    }
  }

  async remove(productId: string, mediaId: string, ctx: ActorContext): Promise<void> {
    const product = await this.products.getOwnedProduct(productId, ctx.companyId);
    const media = await this.prisma.productMedia.findFirst({ where: { id: mediaId, productId } });
    if (!media) throw new NotFoundException("Product media not found");

    // DB reference is removed FIRST and is authoritative the moment
    // this transaction commits — a subsequent Storage-delete failure
    // only ever leaves an orphaned object in Storage (cleaned up
    // later), never a DB row pointing at nothing.
    const { reapproved } = await this.prisma.$transaction(async (tx) => {
      const guard = await this.products.assertEditableTx(tx, product);
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
      const reapproved = await this.products.reapproveIfNeededTx(tx, productId, guard.requiresReapproval);
      return { reapproved };
    });

    await this.bestEffortDelete(media.objectKey);
    await this.bestEffortDelete(media.thumbnailObjectKey);

    await this.auditMutation(productId, ctx, reapproved, "PRODUCT_MEDIA_REMOVED");
  }

  async setMain(productId: string, mediaId: string, ctx: ActorContext): Promise<void> {
    const product = await this.products.getOwnedProduct(productId, ctx.companyId);
    const media = await this.prisma.productMedia.findFirst({ where: { id: mediaId, productId } });
    if (!media) throw new NotFoundException("Product media not found");

    const reapproved = await this.prisma.$transaction(async (tx) => {
      const guard = await this.products.assertEditableTx(tx, product);
      await tx.productMedia.updateMany({ where: { productId }, data: { isMain: false } });
      await tx.productMedia.update({ where: { id: mediaId }, data: { isMain: true } });
      return this.products.reapproveIfNeededTx(tx, productId, guard.requiresReapproval);
    });

    await this.auditMutation(productId, ctx, reapproved, "PRODUCT_MEDIA_MAIN_CHANGED");
  }

  async reorder(productId: string, mediaIds: string[], ctx: ActorContext): Promise<void> {
    const product = await this.products.getOwnedProduct(productId, ctx.companyId);
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
      const guard = await this.products.assertEditableTx(tx, product);
      for (let i = 0; i < mediaIds.length; i++) {
        await tx.productMedia.update({ where: { id: mediaIds[i] }, data: { sortOrder: i } });
      }
      return this.products.reapproveIfNeededTx(tx, productId, guard.requiresReapproval);
    });

    await this.auditMutation(productId, ctx, reapproved, "PRODUCT_MEDIA_REORDERED");
  }

  private async auditMutation(
    productId: string,
    ctx: ActorContext,
    reapproved: boolean,
    action: string
  ): Promise<void> {
    if (reapproved) {
      await this.audit.log({
        actorType: AuditActorType.SYSTEM,
        companyId: ctx.companyId,
        action: "PRODUCT_AUTO_REAPPROVED_ON_EDIT",
        entityType: "product",
        entityId: productId,
        reason: "Product media changed after approval — technical checks passed, new AUTO snapshot created",
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action,
      entityType: "product",
      entityId: productId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
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
