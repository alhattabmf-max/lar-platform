import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { OpportunitySettingsService } from "../settings/opportunity-settings.service";
import { parseSnapshotMedia, selectMainMedia } from "./snapshot-media.util";
import type { ImageTarget } from "../common/media/image-delivery.service";

/**
 * Resolves a publicly visible opportunity to a servable image.
 *
 * The frozen product snapshot stores only `{ objectKey,
 * thumbnailObjectKey, isMain, sortOrder }` — no content type, no ETag,
 * no timestamp. All three are derived here rather than by adding
 * columns, because each is already determined by data that exists:
 *
 *   contentType   The object key's extension. NOT client input: the key
 *                 is built server-side as `${uuid}.${ext}` where ext
 *                 comes from the content type sharp actually decoded.
 *                 An unrecognised extension is treated as missing, so a
 *                 hand-written key cannot smuggle a type through.
 *
 *   etag          An OPAQUE VERSION VALIDATOR derived from the
 *                 immutable storage key — NOT a hash of the bytes.
 *                 It identifies the representation reliably under the
 *                 invariant that keys are never reused (every upload
 *                 mints a fresh UUID; nothing is overwritten in place),
 *                 which makes a 304 answerable without reading the
 *                 object. Because it does not digest the content, it is
 *                 emitted WEAK (`W/"…"`): equal tags mean "same stored
 *                 version", not "provably byte-identical". Banner
 *                 images, hashed from their bytes at upload, stay
 *                 strong.
 *
 *                 The digest also keeps the key itself out of the
 *                 header — the tag is a SHA-256, never the path.
 *
 *   lastModified  The snapshot's approvedAt. A frozen snapshot never
 *                 changes, so neither does the image it points at.
 */

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function contentTypeFromObjectKey(objectKey: string): string | null {
  const lastDot = objectKey.lastIndexOf(".");
  if (lastDot === -1) return null;

  const extension = objectKey.slice(lastDot + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? null;
}

/**
 * Opaque version validator derived from the immutable, never-reused
 * object key. Hashed so the key never appears in a response header.
 *
 * Returned as a WEAK entity-tag: it identifies the stored version, not
 * the bytes.
 */
export function etagForObjectKey(objectKey: string): string {
  return createHash("sha256").update(objectKey).digest("hex");
}

@Injectable()
export class OpportunityImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunitySettings: OpportunitySettingsService
  ) {}

  /**
   * Returns null for every case a caller must not be able to tell
   * apart: unknown id, not publicly visible, a snapshot with no usable
   * media (every pre-7A legacy snapshot), and a key whose extension is
   * not servable.
   */
  async findPublicTarget(
    id: string,
    variant: "main" | "thumb",
    /**
     * WHICH PHOTOGRAPH, in the snapshot's own order.
     *
     * Omitted, it is the main one — which is what every existing caller
     * asks for and what the card has always shown. Given, it indexes
     * the SAME sorted list the detail's gallery is built from, so the
     * n-th url and the n-th image cannot disagree.
     *
     * AN INDEX PAST THE END IS A 404, not a fallback to the main image:
     * a caller asking for a photograph that is not there has a bug, and
     * quietly serving a different one hides it.
     */
    index?: number
  ): Promise<ImageTarget | null> {
    // The SAME visibility rule the list and detail reads use, resolved
    // from settings rather than restated here.
    const settings = await this.opportunitySettings.getConfig();
    const statuses = settings.showScheduledPubliclyEnabled
      ? (["ACTIVE", "SCHEDULED"] as const)
      : (["ACTIVE"] as const);

    const row = await this.prisma.opportunity.findFirst({
      where: { id, status: { in: [...statuses] } },
      select: {
        productApprovalSnapshot: { select: { snapshot: true, approvedAt: true } },
      },
    });
    if (!row?.productApprovalSnapshot) return null;

    const media =
      index === undefined
        ? selectMainMedia(row.productApprovalSnapshot.snapshot)
        : (parseSnapshotMedia(row.productApprovalSnapshot.snapshot)[index] ??
          null);
    if (!media) return null;

    const objectKey = variant === "thumb" ? media.thumbnailObjectKey : media.objectKey;
    const contentType = contentTypeFromObjectKey(objectKey);
    if (!contentType) return null;

    return {
      objectKey,
      contentType,
      etag: etagForObjectKey(objectKey),
      // Weak: derived from the storage key, not from the bytes.
      weakETag: true,
      // Secondary validator. A frozen snapshot never changes, so
      // neither does the image it points at.
      lastModified: row.productApprovalSnapshot.approvedAt,
    };
  }
}
