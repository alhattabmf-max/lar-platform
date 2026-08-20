import { IsEnum, IsOptional } from "class-validator";

/**
 * THE image variant parameter, shared by the public and admin image
 * routes.
 *
 * One definition on purpose: two copies would be free to drift, and a
 * route that silently accepted a value the other rejected is exactly
 * the kind of divergence that turns into "works in admin, 404s in
 * public" months later.
 *
 * An unrecognised value is a 400, never a silent fall back to `main`.
 * Quietly serving something other than what was asked for hides a
 * client bug and makes a typo indistinguishable from a working request.
 *
 *   omitted      → main (the documented default)
 *   "main"       → main
 *   "thumb"      → thumb
 *   anything else → 400
 *
 * Repeated query parameters (`?variant=main&variant=thumb`) arrive as
 * an array, which is not a member of the enum, so they are rejected by
 * the same rule rather than by a separate check.
 */
export enum ImageVariant {
  main = "main",
  thumb = "thumb",
}

export class ImageVariantQueryDto {
  @IsOptional()
  @IsEnum(ImageVariant, {
    message: 'variant must be either "main" or "thumb"',
  })
  variant?: ImageVariant;
}

/** True when the caller asked for the thumbnail. Omitted means main. */
export function wantsThumbnail(query: ImageVariantQueryDto): boolean {
  return query.variant === ImageVariant.thumb;
}
