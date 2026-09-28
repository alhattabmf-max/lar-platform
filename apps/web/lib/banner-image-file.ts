import {
  checkBannerImageShape,
  type BannerImageShape,
  type BannerShapeRejection,
} from "@platform/types";

/**
 * What a picked banner file is, before anything is uploaded.
 *
 * Measuring in the browser is a COURTESY, not a check. It exists so an
 * operator who picks a phone photograph learns immediately — with the
 * actual and the required dimensions — instead of waiting for a
 * round-trip that ends in a refusal. The server measures the same file
 * with a real decoder and its answer is the one that decides; a caller
 * that never opens this screen reaches the endpoint just the same.
 *
 * The dimensions come from the browser's own image decoder, which
 * applies EXIF orientation, so a sideways photograph reports the axes a
 * viewer will actually see. The server does the same.
 */
export interface MeasuredImage {
  width: number;
  height: number;
  /** An object URL owned by the caller — revoke it when done. */
  previewUrl: string;
}

/**
 * How long to wait for the decoder before giving up.
 *
 * A decode that never settles would leave the picker permanently
 * inert with no error and nothing uploaded — the worst of the three
 * outcomes. Giving up hands the file to the server, which decides
 * anyway.
 */
const DECODE_TIMEOUT_MS = 5000;

/**
 * Returns null when this browser cannot measure the file at all —
 * `createObjectURL` missing, the decoder refusing it, or taking too
 * long. Null is NOT a refusal: it means "no local opinion", and the
 * caller should let the upload proceed to the decoder that matters.
 * Refusing on our own blind spot would block formats the server
 * supports and this browser does not.
 */
export async function measureImageFile(
  file: File,
): Promise<MeasuredImage | null> {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function")
    return null;
  if (typeof Image !== "function") return null;

  let previewUrl: string;
  try {
    previewUrl = URL.createObjectURL(file);
  } catch {
    return null;
  }

  const revoke = () => {
    try {
      URL.revokeObjectURL(previewUrl);
    } catch {
      // Nothing to do, and failing to revoke is not worth an error.
    }
  };

  try {
    const size = await new Promise<{ width: number; height: number } | null>(
      (resolve) => {
        let settled = false;
        const finish = (value: { width: number; height: number } | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };

        const timer = setTimeout(() => finish(null), DECODE_TIMEOUT_MS);

        const image = new Image();
        image.onload = () =>
          finish({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => finish(null);
        image.src = previewUrl;
      },
    );

    if (!size || size.width <= 0 || size.height <= 0) {
      revoke();
      return null;
    }

    return { ...size, previewUrl };
  } catch {
    revoke();
    return null;
  }
}

export function rejectionFor(
  measured: MeasuredImage,
  shape: BannerImageShape,
): BannerShapeRejection | null {
  return checkBannerImageShape(measured.width, measured.height, shape);
}
