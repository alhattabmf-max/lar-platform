import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import type { ImageTarget } from "../common/media/image-delivery.service";
import {
  contentTypeFromObjectKey,
  etagForObjectKey,
} from "../opportunities/opportunity-image.service";

/**
 * Resolves one of a supplier's own product images to a servable target.
 *
 * PRIVATE, unlike the opportunity image route. A product may be a DRAFT that
 * has never been published, so its media is not public in any sense — the
 * route sits under `companies/me` behind the session and the supplier guard,
 * and this resolver re-checks ownership on every request.
 *
 * THE URL IS NOT PROOF OF ANYTHING. A path is guessable — `productId` and
 * `mediaId` are both UUIDs a former employee or a shared link might carry — so
 * possession of one must never grant access. Every call re-runs the same
 * three-way check below, in the query, against the CURRENT session's company.
 *
 * The `contentTypeFromObjectKey` and `etagForObjectKey` helpers are the
 * opportunity route's, reused rather than restated: two copies of an ETag
 * derivation would be free to drift, and the whole point of a validator is
 * that it means the same thing everywhere.
 */
@Injectable()
export class ProductMediaImageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns null for every case a caller must not be able to distinguish.
   *
   * Four of them, and they collapse to one answer on purpose:
   *
   *   - no such media id;
   *   - the media exists but belongs to a DIFFERENT product;
   *   - the product exists but belongs to another COMPANY;
   *   - the key has an extension nothing can be served as.
   *
   * A 404 for all four means probing a path reveals nothing — not whether the
   * id exists, not whether it belongs to someone, not whether the caller
   * merely got the product wrong.
   */
  async findOwnedTarget(
    companyId: string,
    productId: string,
    mediaId: string,
    variant: "main" | "thumb"
  ): Promise<ImageTarget | null> {
    const media = await this.prisma.productMedia.findFirst({
      // All three conditions in ONE query. Fetching the media and then
      // comparing the company afterwards is one early return away from
      // serving another company's image.
      where: {
        id: mediaId,
        productId,
        product: { companyId },
      },
      select: {
        objectKey: true,
        thumbnailObjectKey: true,
        createdAt: true,
      },
    });
    if (!media) return null;

    const objectKey = variant === "thumb" ? media.thumbnailObjectKey : media.objectKey;
    const contentType = contentTypeFromObjectKey(objectKey);
    if (!contentType) return null;

    return {
      objectKey,
      contentType,
      // Hashed, so the storage key never reaches a response header. The two
      // variants hash DIFFERENT keys and therefore carry different ETags — a
      // shared validator would let a cached thumbnail satisfy a request for
      // the full image.
      etag: etagForObjectKey(objectKey),
      // Weak: derived from the stored version, not from the bytes.
      weakETag: true,
      // Media rows are immutable once written — a replacement is a new row —
      // so the image cannot change after this timestamp.
      lastModified: media.createdAt,
    };
  }
}
