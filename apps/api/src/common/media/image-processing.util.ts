import sharp from "sharp";
import type { MediaPolicyConfig } from "../../settings/media-policy.service";

export class InvalidImageError extends Error {}

export interface ProcessedImage {
  mainBuffer: Buffer;
  thumbnailBuffer: Buffer;
  contentType: string;
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
 * Validates and processes an uploaded product image.
 *
 * Trust boundary: `buffer` is the only thing trusted here — the
 * client-supplied filename and Content-Type header are never
 * consulted. The image's real format and dimensions come from sharp
 * actually decoding the file signature/header, and a corrupt or
 * mislabeled file fails at that decode step rather than at a
 * filename/extension check.
 */
export async function processProductImage(
  buffer: Buffer,
  policy: MediaPolicyConfig
): Promise<ProcessedImage> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new InvalidImageError("File could not be decoded as an image");
  }

  const format = metadata.format;
  const contentType = format ? FORMAT_TO_CONTENT_TYPE[format] : undefined;
  if (!contentType || !policy.allowedTypes.includes(contentType)) {
    throw new InvalidImageError(
      `Unsupported image type${format ? ` "${format}"` : ""} — allowed: ${policy.allowedTypes.join(", ")}`
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new InvalidImageError("Image has no readable dimensions");
  }

  // Pixel-count check happens BEFORE any resize/decode-to-pixels
  // operation below — this is the defense against a decompression
  // bomb (a tiny file that decodes to an enormous pixel buffer).
  const pixelCount = width * height;
  if (pixelCount > policy.maxPixels) {
    throw new InvalidImageError(
      `Image has ${pixelCount.toLocaleString()} pixels, exceeding the ${policy.maxPixels.toLocaleString()} pixel limit`
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
