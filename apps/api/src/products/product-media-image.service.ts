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
  /**
   * The same image, resolved WITHOUT an ownership clause.
   *
   * FOR THE ADMIN ROUTE ONLY, and the boundary moves rather than
   * disappears: `findOwnedTarget` is gated by the session's COMPANY, this
   * one by the admin session guard on the controller that calls it. There
   * is no company to compare against — an administrator has none — so an
   * ownership clause here could only ever match nothing.
   *
   * IT STILL BINDS THE MEDIA TO THE PRODUCT. `productId` stays in the
   * query: a media id from one product must not be servable through
   * another product's address, or the two ids in the path would stop
   * meaning anything together and a mistyped route would quietly serve the
   * wrong picture.
   *
   * Unknown media, media under a different product, and an unservable key
   * are ONE answer, exactly as on the supplier route.
   */
  async findAnyTarget(
    productId: string,
    mediaId: string,
    variant: "main" | "thumb"
  ): Promise<ImageTarget | null> {
    const media = await this.prisma.productMedia.findFirst({
      where: { id: mediaId, productId },
      select: { objectKey: true, thumbnailObjectKey: true, createdAt: true },
    });
    return media ? this.toTarget(media, variant) : null;
  }
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
    return this.toTarget(media, variant);
  }

  /**
   * One media row and a variant, to something servable.
   *
   * Shared by both resolvers on purpose. The two differ ONLY in what they
   * are allowed to find; once a row is found, the key it serves, the
   * content type it claims and the validator it returns must be identical,
   * or a cached admin preview could satisfy a supplier request and vice
   * versa.
   */
  private toTarget(
    media: { objectKey: string; thumbnailObjectKey: string; createdAt: Date },
    variant: "main" | "thumb"
  ): ImageTarget | null {
    const objectKey = variant === "thumb" ? media.thumbnailObjectKey : media.objectKey;
    const contentType = contentTypeFromObjectKey(objectKey);
    // An extension nothing can be served as is indistinguishable from a
    // missing row, on purpose.
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
