import { IsString, Matches } from "class-validator";

/**
 * Transport-level shape check only. The authoritative validation —
 * normalisation and every contrast rule — lives in
 * BrandThemeService/brand-theme.validation.ts, so the same rules apply
 * however the value arrives.
 *
 * The pattern is repeated here rather than imported because
 * class-validator's `@Matches` needs a literal at decoration time; it is
 * kept identical to HEX_COLOR_PATTERN in @platform/types, and a unit
 * test asserts the two agree.
 */
const HEX = /^#[0-9A-Fa-f]{6}$/;

export class SaveBrandThemeDto {
  @IsString()
  @Matches(HEX, { message: "primary must be a full six-digit hex colour" })
  primary!: string;

  @IsString()
  @Matches(HEX, { message: "secondary must be a full six-digit hex colour" })
  secondary!: string;

  @IsString()
  @Matches(HEX, { message: "accent must be a full six-digit hex colour" })
  accent!: string;

  @IsString()
  @Matches(HEX, { message: "accentInteractive must be a full six-digit hex colour" })
  accentInteractive!: string;
}
