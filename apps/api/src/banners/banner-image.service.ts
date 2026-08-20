import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AuditActorType } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { BannerPolicyService } from "../settings/banner-policy.service";
import { BusinessException } from "../common/errors/business-exception";
import { InvalidImageError, processImage } from "../common/media/image-processing.util";
import { computeETag } from "../common/media/image-delivery.service";
import type { BannerActorContext } from "./banner.service";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Banner image upload and removal.
 *
 * Storage and the database are two systems that cannot share a
 * transaction, so the ordering below is chosen to make every failure
 * mode leave a CONSISTENT database and, at worst, an orphaned object —
 * never a row pointing at bytes that are not there.
 *
 *   upload:  decode â†’ put new objects â†’ atomic DB update
 *            â†’ on DB failure, best-effort delete the NEW objects
 *            â†’ on DB success, best-effort delete the OLD objects
 *
 *   delete:  atomic DB clear â†’ best-effort delete the objects
 *
 * A storage delete that fails is logged and swallowed: an orphan costs
 * disk, while failing the request after the database already committed
 * would report a false failure for work that actually succeeded.
 */
@Injectable()
export class BannerImageService {
  private readonly logger = new Logger(BannerImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly policy: BannerPolicyService
  ) {}

  async upload(bannerId: string, buffer: Buffer, ctx: BannerActorContext) {
    const existing = await this.prisma.promotionalBanner.findUnique({
      where: { id: bannerId },
      select: { id: true, imageObjectKey: true, imageThumbnailKey: true },
    });
    if (!existing) throw new NotFoundException("Banner not found");

    const bannerPolicy = await this.policy.getPolicy();

    if (buffer.byteLength > bannerPolicy.maxSizeBytes) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Image exceeds the ${bannerPolicy.maxSizeBytes} byte limit`
      );
    }

    // Decode FIRST. Nothing is written anywhere until the bytes have
    // been proven to be an image of an accepted format and size — the
    // client's filename and Content-Type are never consulted.
    let processed;
    try {
      processed = await processImage(buffer, bannerPolicy);
    } catch (err) {
      if (err instanceof InvalidImageError) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, err.message);
      }
      throw err;
    }

    const extension = EXTENSION_BY_CONTENT_TYPE[processed.contentType] ?? "bin";
    // A fresh key per upload, never a reused one. This is about ATOMIC
    // REPLACEMENT, not about caching: writing to a new key leaves the
    // old object intact until the database commit succeeds, so a failed
    // update can roll back to a banner whose image still resolves.
    // Overwriting in place would destroy the old bytes before the new
    // row was durable.
    //
    // It does NOT affect what a browser caches: the public URL is
    // derived from the banner id and variant and never changes. Serving
    // fresh bytes after a replacement is the job of the ETag, which is
    // content-derived, together with Cache-Control revalidation.
    const baseKey = `banners/${bannerId}/${randomUUID()}`;
    const objectKey = `${baseKey}.${extension}`;
    const thumbnailKey = `${baseKey}-thumb.${extension}`;

    await this.storage.upload(objectKey, processed.mainBuffer, processed.contentType);
    await this.storage.upload(thumbnailKey, processed.thumbnailBuffer, processed.contentType);

    // Both variants are the same format, so they share one content
    // type — but they are different bytes, so each carries its own tag.
    const imageETag = computeETag(processed.mainBuffer);
    const imageThumbnailETag = computeETag(processed.thumbnailBuffer);

    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.promotionalBanner.update({
          where: { id: bannerId },
          data: {
            imageObjectKey: objectKey,
            imageThumbnailKey: thumbnailKey,
            imageContentType: processed.contentType,
            imageETag,
            imageThumbnailETag,
            imageWidth: processed.width,
            imageHeight: processed.height,
            imageUpdatedAt: new Date(),
          },
        });

        await this.audit.log(
          {
            actorType: AuditActorType.ADMIN,
            actorId: ctx.actorId,
            action: "BANNER_IMAGE_UPLOADED",
            entityType: "promotional_banner",
            entityId: bannerId,
            // Object keys are internal; only the safe descriptors are
            // recorded, so the audit trail never becomes a key index.
            after: {
              contentType: processed.contentType,
              width: processed.width,
              height: processed.height,
              sizeBytes: processed.mainBuffer.byteLength,
            },
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
          tx
        );

        return row;
      });
    } catch (err) {
      // The database never committed, so the new objects are referenced
      // by nothing. Remove them rather than leaving them forever.
      await this.bestEffortDelete(objectKey);
      await this.bestEffortDelete(thumbnailKey);
      throw err;
    }

    // Committed. The old objects are now unreferenced.
    if (existing.imageObjectKey) await this.bestEffortDelete(existing.imageObjectKey);
    if (existing.imageThumbnailKey) await this.bestEffortDelete(existing.imageThumbnailKey);

    return {
      width: updated.imageWidth,
      height: updated.imageHeight,
      contentType: updated.imageContentType,
    };
  }

  async remove(bannerId: string, ctx: BannerActorContext): Promise<void> {
    const existing = await this.prisma.promotionalBanner.findUnique({
      where: { id: bannerId },
      select: { id: true, imageObjectKey: true, imageThumbnailKey: true },
    });
    if (!existing) throw new NotFoundException("Banner not found");

    // Nothing to do, and saying so is not an error.
    if (!existing.imageObjectKey) return;

    // Clear the metadata first. The CHECK constraint requires all eight
    // image columns to move together, so this is all-or-nothing.
    await this.prisma.$transaction(async (tx) => {
      await tx.promotionalBanner.update({
        where: { id: bannerId },
        data: {
          imageObjectKey: null,
          imageThumbnailKey: null,
          imageContentType: null,
          imageETag: null,
          imageThumbnailETag: null,
          imageWidth: null,
          imageHeight: null,
          imageUpdatedAt: null,
        },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "BANNER_IMAGE_DELETED",
          entityType: "promotional_banner",
          entityId: bannerId,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx
      );
    });

    // Only now, with no row referencing them, are the bytes removed.
    await this.bestEffortDelete(existing.imageObjectKey);
    if (existing.imageThumbnailKey) await this.bestEffortDelete(existing.imageThumbnailKey);
  }

  /** Admin preview: any state, no LIVE predicate. Access is the guard's job. */
  async findAdminImage(bannerId: string) {
    const row = await this.prisma.promotionalBanner.findUnique({
      where: { id: bannerId },
      select: {
        imageObjectKey: true,
        imageThumbnailKey: true,
        imageContentType: true,
        imageETag: true,
        imageThumbnailETag: true,
        imageUpdatedAt: true,
      },
    });

    if (
      !row ||
      row.imageObjectKey === null ||
      row.imageThumbnailKey === null ||
      row.imageContentType === null ||
      row.imageETag === null ||
      row.imageThumbnailETag === null ||
      row.imageUpdatedAt === null
    ) {
      return null;
    }

    return {
      imageObjectKey: row.imageObjectKey,
      imageThumbnailKey: row.imageThumbnailKey,
      imageContentType: row.imageContentType,
      imageETag: row.imageETag,
      imageThumbnailETag: row.imageThumbnailETag,
      imageUpdatedAt: row.imageUpdatedAt,
    };
  }

  private async bestEffortDelete(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch (err) {
      this.logger.warn(
        `Failed to delete storage object — left as an orphan for later cleanup: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
    }
  }
}
