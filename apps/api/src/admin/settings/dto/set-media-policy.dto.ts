import { ArrayNotEmpty, IsArray, IsIn, IsInt, Max, Min } from "class-validator";
import { MEDIA_SIZE_HARD_CEILING_BYTES } from "../../../settings/media-policy.service";

const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export class SetMediaPolicyDto {
  @IsInt()
  @Min(102400)
  @Max(MEDIA_SIZE_HARD_CEILING_BYTES)
  maxSizeBytes!: number;

  @IsInt()
  @Min(1)
  @Max(30)
  maxImagesPerProduct!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(SUPPORTED_TYPES, { each: true })
  allowedTypes!: string[];

  @IsInt()
  @Min(1_000_000)
  @Max(100_000_000)
  maxPixels!: number;
}
