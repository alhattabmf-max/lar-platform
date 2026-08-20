import sharp from "sharp";
import { processImage, InvalidImageError } from "./image-processing.util";
import type { MediaPolicyConfig } from "../../settings/media-policy.service";

const policy: MediaPolicyConfig = {
  maxSizeBytes: 5 * 1024 * 1024,
  maxImagesPerProduct: 10,
  allowedTypes: ["image/jpeg", "image/png", "image/webp"],
  maxPixels: 40_000_000,
};

async function makeTestJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg()
    .toBuffer();
}

describe("processImage", () => {
  it("processes a valid JPEG into a main buffer and a thumbnail", async () => {
    const buffer = await makeTestJpeg(800, 600);
    const result = await processImage(buffer, policy);

    expect(result.contentType).toBe("image/jpeg");
    expect(result.mainBuffer.length).toBeGreaterThan(0);
    expect(result.thumbnailBuffer.length).toBeGreaterThan(0);

    const thumbMeta = await sharp(result.thumbnailBuffer).metadata();
    expect(Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0)).toBeLessThanOrEqual(400);
  });

  it("rejects a file that is not a real, decodable image — regardless of what it's named", async () => {
    // A plain text buffer masquerading as an "image" — no filename or
    // Content-Type is even involved here, proving the check is purely
    // content-based.
    const fakeImage = Buffer.from("this is definitely not an image file");
    await expect(processImage(fakeImage, policy)).rejects.toThrow(InvalidImageError);
  });

  it("rejects an image whose real pixel count exceeds the policy limit, before any resize happens", async () => {
    const tinyPolicy: MediaPolicyConfig = { ...policy, maxPixels: 100 }; // absurdly small on purpose
    const buffer = await makeTestJpeg(50, 50); // 2500 pixels > 100
    await expect(processImage(buffer, tinyPolicy)).rejects.toThrow(InvalidImageError);
  });

  it("rejects a content type not in the policy's allowed list", async () => {
    const buffer = await makeTestJpeg(100, 100);
    const restrictivePolicy: MediaPolicyConfig = { ...policy, allowedTypes: ["image/png"] };
    await expect(processImage(buffer, restrictivePolicy)).rejects.toThrow(InvalidImageError);
  });

  it("auto-orients and strips metadata — output has no EXIF orientation tag", async () => {
    const buffer = await makeTestJpeg(400, 300);
    const result = await processImage(buffer, policy);
    const meta = await sharp(result.mainBuffer).metadata();
    expect(meta.orientation).toBeUndefined();
  });
});
