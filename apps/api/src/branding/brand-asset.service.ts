import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  AuditActorType,
  type BrandAssetLocale as PrismaBrandAssetLocale,
} from "@prisma/client";
import {
  BRAND_ASSET_CONTENT_TYPES,
  BRAND_ASSET_LOCALES,
  BRAND_LOGO_LIMITS as SHARED_BRAND_LOGO_LIMITS,
  ERROR_CODES,
  type BrandAssetLocale,
  type BrandAssetsAdminView,
  type ErrorCode,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { BusinessException } from "../common/errors/business-exception";
import {
  InvalidImageError,
  processImage,
  type ImageRejectionReason,
} from "../common/media/image-processing.util";
import { computeETag } from "../common/media/image-delivery.service";

/**
 * The header logo, one per language.
 *
 * WHY THIS IS NOT A URL FIELD. It used to be: an operator pasted an
 * address and every visitor's browser fetched it. That is an off-site
 * request this product does not otherwise make, embedded in the one
 * element on every page. Here the bytes are decoded by our own
 * processor, stored under a key we choose, and served by our own route.
 *
 * UPLOADING AND PUBLISHING ARE SEPARATE. A logo can be replaced without
 * anyone seeing the change, and the pair goes live in one act. That is
 * what makes "both languages or neither" enforceable: publishing checks
 * the set, so a visitor can never meet a half-changed identity.
 *
 * STORAGE AND THE DATABASE CANNOT SHARE A TRANSACTION, so the ordering
 * below is chosen to make every failure leave a CONSISTENT database
 * and, at worst, an orphaned object:
 *
 *   upload:  decode → put new objects → atomic row write
 *            → on row failure, delete the NEW objects
 *            → on success, delete the OLD ones
 *
 *   delete:  atomic row delete → best-effort delete of the objects
 */

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * What a header logo may be.
 *
 * The numbers come from the shared contract so the server's refusal and
 * the sentence an operator reads above the file picker cannot disagree.
 * Only the format list is rebuilt here, and only because
 * `processImage` takes an `ImageProcessingPolicy` whose `allowedTypes`
 * is a mutable `string[]`; the VALUES are still the shared constant, so
 * the accepted formats cannot drift from the database CHECK either.
 */
export const BRAND_LOGO_LIMITS = {
  ...SHARED_BRAND_LOGO_LIMITS,
  allowedTypes: [...BRAND_ASSET_CONTENT_TYPES] as string[],
};

/**
 * Which refusal an operator is looking at.
 *
 * `VALIDATION_FAILED` was one code for four different problems, and the
 * web app may only key its message off the code — so a logo that was
 * merely too big, one that was the wrong format, and one that was too
 * small all produced "the submitted data is not valid". Each of these
 * has a different fix, so each gets a code that can carry one.
 */
const REJECTION_CODE: Record<ImageRejectionReason, ErrorCode> = {
  UNDECODABLE: ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED,
  TYPE_NOT_ALLOWED: ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED,
  // A file that decodes but reports no dimensions is broken in a way an
  // operator can only fix by re-exporting it — the same action.
  DIMENSIONS_UNREADABLE: ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED,
  TOO_MANY_PIXELS: ERROR_CODES.BRAND_LOGO_TOO_MANY_PIXELS,
};

const LOCALE_CODE_BY_MEMBER: Record<PrismaBrandAssetLocale, BrandAssetLocale> =
  {
    AR_SA: "ar-SA",
    EN_SA: "en-SA",
  };

const LOCALE_MEMBER_BY_CODE: Record<BrandAssetLocale, PrismaBrandAssetLocale> =
  {
    "ar-SA": "AR_SA",
    "en-SA": "EN_SA",
  };

export interface BrandAssetActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/** What the delivery route needs, and nothing else. */
export interface BrandAssetImageRow {
  objectKey: string;
  thumbnailKey: string;
  contentType: string;
  etag: string;
  thumbnailETag: string;
  updatedAt: Date;
}

@Injectable()
export class BrandAssetService {
  private readonly logger = new Logger(BrandAssetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ----- public read -------------------------------------------------------

  /**
   * The PUBLISHED logo for one language, or null.
   *
   * Unpublished rows are invisible here, which is what makes preparing
   * a new logo safe: it can be uploaded, looked at, and replaced again
   * without any visitor seeing a change.
   *
   * NO FALLBACK. A missing Arabic logo yields null, never the English
   * one — the header then renders its blank placeholder.
   */
  async findPublished(
    locale: BrandAssetLocale,
  ): Promise<BrandAssetImageRow | null> {
    const row = await this.prisma.brandAsset.findUnique({
      where: { locale: LOCALE_MEMBER_BY_CODE[locale] },
    });
    if (!row || row.publishedAt === null) return null;

    return {
      objectKey: row.objectKey,
      thumbnailKey: row.thumbnailKey,
      contentType: row.contentType,
      etag: row.etag,
      thumbnailETag: row.thumbnailETag,
      updatedAt: row.updatedAt,
    };
  }

  /** Whether a language has a published logo, without reading its keys. */
  async hasPublished(locale: BrandAssetLocale): Promise<boolean> {
    const row = await this.prisma.brandAsset.findUnique({
      where: { locale: LOCALE_MEMBER_BY_CODE[locale] },
      select: { publishedAt: true },
    });
    return row?.publishedAt != null;
  }

  // ----- admin read --------------------------------------------------------

  /** The set, as the identity screen sees it. No object keys. */
  async listForAdmin(): Promise<BrandAssetsAdminView> {
    const rows = await this.prisma.brandAsset.findMany({
      select: {
        locale: true,
        width: true,
        height: true,
        contentType: true,
        publishedAt: true,
        updatedAt: true,
      },
    });

    const assets = rows.map((row) => ({
      locale: LOCALE_CODE_BY_MEMBER[row.locale],
      width: row.width,
      height: row.height,
      contentType: row.contentType,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }));

    const present = new Set(assets.map((asset) => asset.locale));
    return {
      assets,
      complete: BRAND_ASSET_LOCALES.every((locale) => present.has(locale)),
      published:
        BRAND_ASSET_LOCALES.every((locale) => present.has(locale)) &&
        assets.every((asset) => asset.publishedAt !== null),
    };
  }

  /** Admin preview: any state, published or not. Access is the guard's job. */
  async findForAdmin(
    locale: BrandAssetLocale,
  ): Promise<BrandAssetImageRow | null> {
    const row = await this.prisma.brandAsset.findUnique({
      where: { locale: LOCALE_MEMBER_BY_CODE[locale] },
    });
    if (!row) return null;

    return {
      objectKey: row.objectKey,
      thumbnailKey: row.thumbnailKey,
      contentType: row.contentType,
      etag: row.etag,
      thumbnailETag: row.thumbnailETag,
      updatedAt: row.updatedAt,
    };
  }

  // ----- writes ------------------------------------------------------------

  /**
   * Stores one language's logo, replacing whatever was there.
   *
   * Replacing UNPUBLISHES nothing on its own: if the set was live, the
   * new bytes go live with it. That is deliberate — an operator
   * replacing a logo means to change what people see, and requiring a
   * second "publish" press for an already-published set would be a step
   * whose only effect is to make the change easy to forget.
   */
  async upload(
    locale: BrandAssetLocale,
    buffer: Buffer,
    ctx: BrandAssetActorContext,
  ) {
    const member = LOCALE_MEMBER_BY_CODE[locale];

    const existing = await this.prisma.brandAsset.findUnique({
      where: { locale: member },
      select: { objectKey: true, thumbnailKey: true },
    });

    if (buffer.byteLength > BRAND_LOGO_LIMITS.maxSizeBytes) {
      throw new BusinessException(
        400,
        ERROR_CODES.BRAND_LOGO_TOO_LARGE,
        `Logo is ${buffer.byteLength} bytes, over the ${BRAND_LOGO_LIMITS.maxSizeBytes} byte limit`,
      );
    }

    // Decode FIRST. Nothing is written anywhere until the bytes have
    // been proven to be an image of an accepted format — the client's
    // filename and Content-Type are never consulted.
    let processed;
    try {
      processed = await processImage(buffer, BRAND_LOGO_LIMITS);
    } catch (err) {
      if (err instanceof InvalidImageError) {
        // The message goes to the log; the CODE is what decides what the
        // operator reads. An unlabelled rejection can only be the
        // generic one — but every path in `processImage` labels itself,
        // so that branch is a guard against a future one that does not.
        const code = err.reason
          ? REJECTION_CODE[err.reason]
          : ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED;
        throw new BusinessException(400, code, err.message);
      }
      throw err;
    }

    if (
      processed.width < BRAND_LOGO_LIMITS.minWidth ||
      processed.height < BRAND_LOGO_LIMITS.minHeight
    ) {
      throw new BusinessException(
        400,
        ERROR_CODES.BRAND_LOGO_TOO_SMALL,
        `Logo is ${processed.width}x${processed.height}, smaller than the ` +
          `${BRAND_LOGO_LIMITS.minWidth}x${BRAND_LOGO_LIMITS.minHeight} minimum`,
      );
    }

    const extension = EXTENSION_BY_CONTENT_TYPE[processed.contentType] ?? "bin";
    // A fresh key per upload, never a reused one: writing to a new key
    // leaves the old object intact until the row write succeeds, so a
    // failure rolls back to a logo that still resolves.
    const baseKey = `brand/logo/${locale}/${randomUUID()}`;
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

    const etag = computeETag(processed.mainBuffer);
    const thumbnailETag = computeETag(processed.thumbnailBuffer);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.brandAsset.upsert({
          where: { locale: member },
          create: {
            locale: member,
            objectKey,
            thumbnailKey,
            contentType: processed.contentType,
            etag,
            thumbnailETag,
            width: processed.width,
            height: processed.height,
          },
          update: {
            objectKey,
            thumbnailKey,
            contentType: processed.contentType,
            etag,
            thumbnailETag,
            width: processed.width,
            height: processed.height,
          },
        });

        await this.audit.log(
          {
            actorType: AuditActorType.ADMIN,
            actorId: ctx.actorId,
            action: existing ? "BRAND_LOGO_REPLACED" : "BRAND_LOGO_UPLOADED",
            entityType: "brand_asset",
            entityId: locale,
            // Storage keys are internal; only the safe descriptors are
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
      });
    } catch (err) {
      // The row never committed, so the new objects are referenced by
      // nothing. Remove them rather than leaving them forever.
      await this.discard([objectKey, thumbnailKey]);
      throw err;
    }

    // Committed. The old objects are now unreferenced.
    if (existing)
      await this.discard([existing.objectKey, existing.thumbnailKey]);

    return { locale, width: processed.width, height: processed.height };
  }

  /**
   * Publishes the set — every language at once, or not at all.
   *
   * REFUSES AN INCOMPLETE SET. Publishing one language would put a
   * half-changed identity in front of visitors: the header would show a
   * new Arabic mark beside an old English one, or a blank where the
   * other used to be. The check and the write share a transaction so
   * the set cannot become incomplete between them.
   */
  async publish(ctx: BrandAssetActorContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.brandAsset.findMany({ select: { locale: true } });
      const present = new Set(
        rows.map((row) => LOCALE_CODE_BY_MEMBER[row.locale]),
      );
      const missing = BRAND_ASSET_LOCALES.filter(
        (locale) => !present.has(locale),
      );

      if (missing.length > 0) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Cannot publish an incomplete logo set. Missing: ${missing.join(", ")}`,
        );
      }

      const publishedAt = new Date();
      await tx.brandAsset.updateMany({ data: { publishedAt } });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "BRAND_LOGO_PUBLISHED",
          entityType: "brand_asset",
          entityId: "set",
          after: {
            locales: [...BRAND_ASSET_LOCALES],
            publishedAt: publishedAt.toISOString(),
          },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /**
   * Removes the whole set.
   *
   * BOTH LANGUAGES TOGETHER, because a header with one logo and one
   * blank is not a state anyone chose. There is no per-language delete
   * for the same reason there is no per-language publish.
   */
  async deleteAll(ctx: BrandAssetActorContext): Promise<void> {
    const orphaned = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.brandAsset.findMany({
        select: { locale: true, objectKey: true, thumbnailKey: true },
      });
      if (rows.length === 0)
        throw new NotFoundException("No brand logos to delete");

      await tx.brandAsset.deleteMany({});

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "BRAND_LOGO_DELETED",
          entityType: "brand_asset",
          entityId: "set",
          // WHICH LANGUAGES were removed, and not one storage key.
          before: {
            locales: rows.map((row) => LOCALE_CODE_BY_MEMBER[row.locale]),
          },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return rows.flatMap((row) => [row.objectKey, row.thumbnailKey]);
    });

    await this.discard(orphaned);
  }

  /**
   * Drops objects whose rows are already gone.
   *
   * A failure here does NOT restore the deleted identity and does NOT
   * fail the request: the rows are gone as far as every reader is
   * concerned, and reporting a failure for work that succeeded would be
   * a lie. The log names nothing but the count — a warning stream
   * carrying storage keys would become an index of them.
   */
  private async discard(objectKeys: readonly string[]): Promise<void> {
    let failed = 0;
    for (const key of objectKeys) {
      try {
        await this.storage.delete(key);
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      this.logger.warn(
        `Failed to delete ${failed} brand logo object(s) — left as orphans for later cleanup`,
      );
    }
  }
}
