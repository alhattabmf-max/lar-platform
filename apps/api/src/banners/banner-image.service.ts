import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AuditActorType } from "@prisma/client";
import {
  ERROR_CODES,
  checkBannerImageShape,
  describeBannerShapeRejection,
  type BannerImageLocale,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { BannerPolicyService } from "../settings/banner-policy.service";
import { BusinessException } from "../common/errors/business-exception";
import {
  InvalidImageError,
  processImage,
} from "../common/media/image-processing.util";
import { computeETag } from "../common/media/image-delivery.service";
import { toLocaleMember, type BannerActorContext } from "./banner.service";

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
    private readonly policy: BannerPolicyService,
  ) {}

  async upload(
    bannerId: string,
    locale: BannerImageLocale,
    buffer: Buffer,
    ctx: BannerActorContext,
  ) {
    const member = toLocaleMember(locale);

    const banner = await this.prisma.promotionalBanner.findUnique({
      where: { id: bannerId },
      select: { id: true },
    });
    if (!banner) throw new NotFoundException("Banner not found");

    // The artwork this language already has, if any. Replacing one
    // language leaves the other untouched — they are separate rows.
    const existing = await this.prisma.bannerImage.findUnique({
      where: { bannerId_locale: { bannerId, locale: member } },
      select: { objectKey: true, thumbnailKey: true },
    });

    const bannerPolicy = await this.policy.getPolicy();

    if (buffer.byteLength > bannerPolicy.maxSizeBytes) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Image exceeds the ${bannerPolicy.maxSizeBytes} byte limit`,
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
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          err.message,
        );
      }
      throw err;
    }

    // THE SHAPE, decided here and nowhere else.
    //
    // The browser checks the same rule before uploading, but only to
    // fail fast with a useful message — this is the check that counts.
    // A caller that never opens the admin screen reaches this endpoint
    // just the same.
    const rejection = checkBannerImageShape(
      processed.width,
      processed.height,
      bannerPolicy.imageShape,
    );
    if (rejection !== null) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        describeBannerShapeRejection(rejection, bannerPolicy.imageShape),
      );
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
    // The locale is part of the path, so the two languages' objects
    // are never confusable when looking at storage directly.
    const baseKey = `banners/${bannerId}/${locale}/${randomUUID()}`;
    const objectKey = `${baseKey}.${extension}`;
    const thumbnailKey = `${baseKey}-thumb.${extension}`;

    await this.storage.upload(
      objectKey,
      processed.mainBuffer,
      processed.contentType,
    );
    await this.storage.upload(
      thumbnailKey,
      processed.thumbnailBuffer,
      processed.contentType,
    );

    // Both variants are the same format, so they share one content
    // type — but they are different bytes, so each carries its own tag.
    const imageETag = computeETag(processed.mainBuffer);
    const imageThumbnailETag = computeETag(processed.thumbnailBuffer);

    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        // Upsert on (banner, locale): a language has exactly one artwork
        // row, and replacing it updates that row rather than growing a
        // second one. The unique index enforces the same thing.
        const row = await tx.bannerImage.upsert({
          where: { bannerId_locale: { bannerId, locale: member } },
          create: {
            bannerId,
            locale: member,
            objectKey,
            thumbnailKey,
            contentType: processed.contentType,
            etag: imageETag,
            thumbnailETag: imageThumbnailETag,
            width: processed.width,
            height: processed.height,
          },
          update: {
            objectKey,
            thumbnailKey,
            contentType: processed.contentType,
            etag: imageETag,
            thumbnailETag: imageThumbnailETag,
            width: processed.width,
            height: processed.height,
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
              locale,
              contentType: processed.contentType,
              width: processed.width,
              height: processed.height,
              sizeBytes: processed.mainBuffer.byteLength,
            },
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
          tx,
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

    // Committed. This language's previous objects are now unreferenced;
    // the other language's are untouched.
    if (existing) {
      await this.bestEffortDelete(existing.objectKey);
      await this.bestEffortDelete(existing.thumbnailKey);
    }

    return {
      locale,
      width: updated.width,
      height: updated.height,
      contentType: updated.contentType,
    };
  }

  async remove(
    bannerId: string,
    locale: BannerImageLocale,
    ctx: BannerActorContext,
  ): Promise<void> {
    const member = toLocaleMember(locale);

    const existing = await this.prisma.bannerImage.findUnique({
      where: { bannerId_locale: { bannerId, locale: member } },
      select: { objectKey: true, thumbnailKey: true },
    });

    // Nothing to do, and saying so is not an error. Removing artwork a
    // language never had is a no-op, not a 404 — the banner may well
    // exist and simply have nothing for this language.
    if (!existing) return;

    // Delete the ROW. There is no partially-cleared state to arrange for
    // any more: the row's columns are all NOT NULL, so its absence is
    // exactly what "this language has no artwork" means.
    await this.prisma.$transaction(async (tx) => {
      await tx.bannerImage.delete({
        where: { bannerId_locale: { bannerId, locale: member } },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "BANNER_IMAGE_DELETED",
          entityType: "promotional_banner",
          entityId: bannerId,
          before: { locale },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });

    // Only now, with no row referencing them, are the bytes removed.
    await this.bestEffortDelete(existing.objectKey);
    await this.bestEffortDelete(existing.thumbnailKey);
  }

  /** Admin preview: any state, no LIVE predicate. Access is the guard's job. */
  async findAdminImage(bannerId: string, locale: BannerImageLocale) {
    const row = await this.prisma.bannerImage.findUnique({
      where: { bannerId_locale: { bannerId, locale: toLocaleMember(locale) } },
    });

    // Every column is NOT NULL, so the row either exists and is complete
    // or does not exist. The six null checks the old shape needed are
    // gone with the nullable columns that made them necessary.
    if (!row) return null;

    return {
      imageObjectKey: row.objectKey,
      imageThumbnailKey: row.thumbnailKey,
      imageContentType: row.contentType,
      imageETag: row.etag,
      imageThumbnailETag: row.thumbnailETag,
      imageUpdatedAt: row.updatedAt,
    };
  }

  /**
   * Drops the stored objects of a banner whose ROW IS ALREADY GONE.
   *
   * Called after the delete transaction commits, never inside it:
   * storage and the database cannot share a transaction, and removing
   * the files first would leave a row pointing at bytes that are not
   * there if the transaction then rolled back. This way the worst case
   * is an orphaned object, which costs disk and nothing else.
   *
   * A failure here does NOT fail the request. The banner is already
   * gone as far as every reader is concerned, and reporting a failure
   * for work that actually succeeded would be a lie.
   *
   * The log names the BANNER, never the object keys: a warning stream
   * that carried storage keys would become an index of them.
   */
  async discardStoredImages(
    bannerId: string,
    objectKeys: readonly string[],
  ): Promise<void> {
    for (const key of objectKeys) {
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.logger.warn(
          `Failed to delete a stored image for deleted banner ${bannerId} — left as an orphan for later cleanup: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        );
      }
    }
  }

  private async bestEffortDelete(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch (err) {
      this.logger.warn(
        `Failed to delete storage object — left as an orphan for later cleanup: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
    }
  }
}
