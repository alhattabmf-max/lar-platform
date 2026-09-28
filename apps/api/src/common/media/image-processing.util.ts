import sharp from "sharp";

/**
 * WHY a decode was refused, as a value rather than as English prose.
 *
 * The message this error carries names byte counts and formats and is
 * written for a log. A caller that wants to tell an operator what to DO
 * about it needs something it can branch on, and parsing the message
 * back out would make that prose a contract.
 */
export type ImageRejectionReason =
  /** sharp could not read it as any image at all. */
  | "UNDECODABLE"
  /** Decoded, but not one of the formats the caller allows. */
  | "TYPE_NOT_ALLOWED"
  /** Decoded, but reported no width or height. */
  | "DIMENSIONS_UNREADABLE"
  /** Decoded, but larger than the caller's pixel ceiling. */
  | "TOO_MANY_PIXELS";

export class InvalidImageError extends Error {
  /**
   * Optional so the existing callers — banners, product media — go on
   * catching this exactly as they did. They map every rejection to one
   * response, which is the right shape for them.
   */
  readonly reason?: ImageRejectionReason;

  constructor(message: string, reason?: ImageRejectionReason) {
    super(message);
    this.name = "InvalidImageError";
    this.reason = reason;
  }
}

export interface ProcessedImage {
  mainBuffer: Buffer;
  thumbnailBuffer: Buffer;
  contentType: string;
  /**
   * The image AS IT WILL BE SEEN, in pixels.
   *
   * Read from metadata, so these are the uploaded dimensions rather
   * than the resized ones — a minimum-dimension rule has to judge what
   * the person actually supplied, not what this function shrank it to.
   *
   * ORIENTATION IS APPLIED. The rotate() call below auto-orients from
   * the EXIF tag, so a photo tagged sideways is displayed with its axes
   * swapped. Reporting the stored axes would claim an image is
   * 4000x3000 when every viewer sees 3000x4000, and an aspect-ratio
   * check on that is simply wrong.
   */
  width: number;
  height: number;
}

const FORMAT_TO_CONTENT_TYPE: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const MAIN_MAX_DIMENSION = 2000;
const THUMBNAIL_MAX_DIMENSION = 400;

/**
 * The only policy fields this processor reads. Declared structurally so
 * a caller with a different policy shape — promotional banners have no
 * `maxImagesPerProduct` — can reuse this function without a second
 * implementation. Forking it would fork a security-critical decode path.
 *
 * `MediaPolicyConfig` satisfies this structurally, so product uploads
 * are unaffected.
 */
export interface ImageProcessingPolicy {
  allowedTypes: string[];
  maxPixels: number;
}

/**
 * Validates and processes an uploaded image.
 *
 * Trust boundary: `buffer` is the only thing trusted here — the
 * client-supplied filename and Content-Type header are never
 * consulted. The image's real format and dimensions come from sharp
 * actually decoding the file signature/header, and a corrupt or
 * mislabeled file fails at that decode step rather than at a
 * filename/extension check.
 *
 * Both variants are emitted in the SAME format, so they share one
 * content type — but they are different bytes (different resize,
 * different quality), so each needs its own ETag.
 */
export async function processImage(
  buffer: Buffer,
  policy: ImageProcessingPolicy,
): Promise<ProcessedImage> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new InvalidImageError(
      "File could not be decoded as an image",
      "UNDECODABLE",
    );
  }

  const format = metadata.format;
  const contentType = format ? FORMAT_TO_CONTENT_TYPE[format] : undefined;
  if (!contentType || !policy.allowedTypes.includes(contentType)) {
    throw new InvalidImageError(
      `Unsupported image type${format ? ` "${format}"` : ""} — allowed: ${policy.allowedTypes.join(", ")}`,
      "TYPE_NOT_ALLOWED",
    );
  }

  const storedWidth = metadata.width ?? 0;
  const storedHeight = metadata.height ?? 0;

  // EXIF orientations 5-8 turn the image a quarter, which swaps what a
  // viewer sees. 1-4 do not.
  const quarterTurned =
    typeof metadata.orientation === "number" && metadata.orientation >= 5;
  const width = quarterTurned ? storedHeight : storedWidth;
  const height = quarterTurned ? storedWidth : storedHeight;
  if (width <= 0 || height <= 0) {
    throw new InvalidImageError(
      "Image has no readable dimensions",
      "DIMENSIONS_UNREADABLE",
    );
  }

  // Pixel-count check happens BEFORE any resize/decode-to-pixels
  // operation below — this is the defense against a decompression
  // bomb (a tiny file that decodes to an enormous pixel buffer).
  const pixelCount = width * height;
  if (pixelCount > policy.maxPixels) {
    throw new InvalidImageError(
      `Image has ${pixelCount.toLocaleString()} pixels, exceeding the ${policy.maxPixels.toLocaleString()} pixel limit`,
      "TOO_MANY_PIXELS",
    );
  }

  const sharpFormat = format as keyof sharp.FormatEnum;

  // .rotate() with no args: auto-orients from the EXIF orientation tag,
  // then that tag (and all other EXIF/ICC/XMP metadata) is dropped
  // because .withMetadata() is deliberately never called — sharp's
  // default output carries no metadata.
  const mainBuffer = await sharp(buffer)
    .rotate()
    .resize({
      width: MAIN_MAX_DIMENSION,
      height: MAIN_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toFormat(sharpFormat, { quality: 82 })
    .toBuffer();

  const thumbnailBuffer = await sharp(buffer)
    .rotate()
    .resize({
      width: THUMBNAIL_MAX_DIMENSION,
      height: THUMBNAIL_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toFormat(sharpFormat, { quality: 75 })
    .toBuffer();

  return { mainBuffer, thumbnailBuffer, contentType, width, height };
}
