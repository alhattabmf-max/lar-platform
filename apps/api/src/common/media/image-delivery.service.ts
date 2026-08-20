import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { StorageService } from "../../storage/storage.service";

/**
 * Shared, resource-agnostic image delivery.
 *
 * This service is NEVER routable. Each resource owns its own endpoint,
 * applies its own visibility rule, resolves its own storage key, and
 * then hands the resolved target here. That split is what keeps the
 * object key out of the request/response surface entirely: there is no
 * code path from user input to a storage key, because the only input
 * this service takes is a target the caller already resolved.
 *
 * Promotional banners use it in 8C; product media reuses it unchanged
 * in 8E.
 */

/**
 * Formats a raw hex digest as an HTTP entity-tag.
 *
 * `weak` produces `W/"…"`. The distinction is a claim about what the
 * tag is derived from, and it should be honest:
 *
 *   strong  the digest is of the BYTES served, so equal tags guarantee
 *           byte-identical representations (banner images, hashed at
 *           upload).
 *   weak    the digest is of an immutable storage key — an opaque
 *           version identifier, not a content hash. It identifies the
 *           representation reliably under the invariant that keys are
 *           never reused, but it is not a byte digest, so claiming
 *           strength would be a claim the value does not support.
 *
 * Both are valid for If-None-Match, which uses weak comparison.
 */
export function formatETag(hex: string, weak = false): string {
  return weak ? `W/"${hex}"` : `"${hex}"`;
}

/** Strips the weakness prefix, leaving the opaque tag for comparison. */
function opaqueTag(etag: string): string {
  const trimmed = etag.trim();
  return trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
}

/** SHA-256 of the exact bytes served. Computed once at upload, never per request. */
export function computeETag(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * The only content types the processor emits, re-asserted at serve time.
 * A stored value outside this set means the row was written by something
 * other than the processor — served as 404 rather than trusted.
 */
const SERVABLE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

export interface ImageTarget {
  objectKey: string;
  contentType: string;
  /** Raw hex digest. Never the object key itself — see `weakETag`. */
  etag: string;
  /**
   * True when `etag` identifies a version rather than hashing the bytes
   * (an opaque validator derived from an immutable storage key). Emits
   * `W/"…"`. Defaults to false for byte-derived digests.
   */
  weakETag?: boolean;
  /** When the image itself last changed — never when the owning row's text changed. */
  lastModified: Date;
}

export interface ConditionalHeaders {
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}

export interface ImageResponse {
  status: 200 | 304;
  headers: Record<string, string>;
  body: Buffer | null;
}

/**
 * RFC 9110 §13.1.2: a recipient MUST ignore If-Modified-Since when the
 * request carries If-None-Match. Precedence is therefore not a
 * preference here — evaluating both would be a spec violation.
 */
export function matchesIfNoneMatch(header: string, currentETag: string): boolean {
  const value = header.trim();
  if (value === "*") return true;

  // RFC 9110 §8.8.3.2: If-None-Match uses WEAK comparison, so the
  // weakness prefix is stripped from BOTH sides. Normalising only the
  // candidate would make a weak tag fail to match itself — the client
  // echoes back exactly what was sent, and `W/"abc"` would be compared
  // against `W/"abc"` with one side stripped.
  const current = opaqueTag(currentETag);

  return value
    .split(",")
    .map(opaqueTag)
    .some((candidate) => candidate === current);
}

export function matchesIfModifiedSince(header: string, lastModified: Date): boolean {
  const since = Date.parse(header);
  if (Number.isNaN(since)) return false;
  // HTTP-date has one-second resolution; truncate before comparing so a
  // sub-second difference is not reported as a modification.
  return Math.floor(lastModified.getTime() / 1000) * 1000 <= since;
}

@Injectable()
export class ImageDeliveryService {
  private readonly logger = new Logger(ImageDeliveryService.name);

  constructor(private readonly storage: StorageService) {}

  async serve(target: ImageTarget, conditional: ConditionalHeaders = {}): Promise<ImageResponse> {
    if (!SERVABLE_CONTENT_TYPES.has(target.contentType)) {
      this.logger.error(
        `Refusing to serve object with untrusted content type "${target.contentType}" — treating as missing`
      );
      throw new NotFoundException("Image not found");
    }

    const etag = formatETag(target.etag, target.weakETag ?? false);
    const lastModified = target.lastModified.toUTCString();

    const validators: Record<string, string> = {
      ETag: etag,
      "Last-Modified": lastModified,
      "Cache-Control": CACHE_CONTROL,
      // Ranges are not supported in 8C: these images are small and fully
      // buffered, so range parsing would add surface for no benefit.
      "Accept-Ranges": "none",
      "X-Content-Type-Options": "nosniff",
    };

    const notModified =
      conditional.ifNoneMatch !== undefined
        ? matchesIfNoneMatch(conditional.ifNoneMatch, etag)
        : conditional.ifModifiedSince !== undefined
          ? matchesIfModifiedSince(conditional.ifModifiedSince, target.lastModified)
          : false;

    if (notModified) {
      // 304 carries the validators and no body, and deliberately no
      // Content-Type or Content-Length.
      return { status: 304, headers: validators, body: null };
    }

    let body: Buffer;
    try {
      body = await this.storage.read(target.objectKey);
    } catch (err) {
      // An orphaned or unreadable object is indistinguishable from a
      // missing one to the caller — never a 500.
      this.logger.warn(
        `Storage read failed for a referenced object — serving 404: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
      throw new NotFoundException("Image not found");
    }

    return {
      status: 200,
      headers: {
        ...validators,
        "Content-Type": target.contentType,
        "Content-Length": String(body.byteLength),
      },
      body,
    };
  }
}
