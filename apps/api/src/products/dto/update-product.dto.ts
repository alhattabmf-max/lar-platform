import { IsNumber, IsPositive, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from "class-validator";
import { Transform } from "class-transformer";
import { PRODUCT_DECIMAL_FIELDS, PRODUCT_TEXT_LIMITS } from "@platform/types";
import { IsDecimalAmount } from "../../common/validation/is-decimal-amount.decorator";

/**
 * Editing a product.
 *
 * THREE states per field, and `@IsOptional()` cannot express them:
 *
 *   omitted (`undefined`)  leave it as it is
 *   a value               set it
 *   `null`                CLEAR it
 *
 * `@IsOptional()` skips validation for BOTH `undefined` and `null`, so a
 * field marked with it would accept `null` — and Prisma would then try to
 * write null into a NOT NULL column and fail as a 500. The two guards
 * below say which of the two a field means:
 *
 *   `@Present()`        validate unless omitted — so `null` is REJECTED
 *                       by the value validators that follow.
 *   `@PresentOrNull()`  validate unless omitted or null — so `null` is
 *                       allowed through as an explicit clear.
 *
 * Only fields whose column is nullable get `@PresentOrNull()`. The list
 * is `CLEARABLE_PRODUCT_FIELDS` in `@platform/types`, and a contract test
 * asserts the two agree.
 *
 * Every bound is the same shared constant the create DTO uses. A copied
 * rule is one that gets tightened on one side and forgotten on the other,
 * which would make edit a back door into the column.
 */

/** Validated unless omitted. `null` reaches the validators and is refused. */
const Present = () => ValidateIf((_object, value) => value !== undefined);

/** Validated unless omitted or null. `null` passes through as a clear. */
const PresentOrNull = () =>
  ValidateIf((_object, value) => value !== undefined && value !== null);

const trim = () => Transform(({ value }) => (typeof value === "string" ? value.trim() : value));

export class UpdateProductDto {
  @Present()
  @IsUUID()
  taxonomyNodeId?: string;

  /** Clearable: the soft reference may be removed; the NAMES are not touched. */
  @PresentOrNull()
  @IsUUID()
  salesUnitId?: string | null;

  @Present()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.salesUnitNameAr)
  salesUnitNameAr?: string;

  @Present()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.salesUnitNameEn)
  salesUnitNameEn?: string;

  // ---- the package-content group: set together, cleared together ----

  @PresentOrNull()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(
    PRODUCT_DECIMAL_FIELDS.packageContentQuantity.scale,
    PRODUCT_DECIMAL_FIELDS.packageContentQuantity.max
  )
  packageContentQuantity?: number | null;

  @PresentOrNull()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.packageContentUnitNameAr)
  packageContentUnitNameAr?: string | null;

  @PresentOrNull()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.packageContentUnitNameEn)
  packageContentUnitNameEn?: string | null;

  // -------------------------------------------------------------------

  @Present()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.nameAr)
  nameAr?: string;

  @Present()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.nameEn)
  nameEn?: string;

  @PresentOrNull()
  @trim()
  @IsString()
  @MaxLength(PRODUCT_TEXT_LIMITS.descriptionAr)
  descriptionAr?: string | null;

  @PresentOrNull()
  @trim()
  @IsString()
  @MaxLength(PRODUCT_TEXT_LIMITS.descriptionEn)
  descriptionEn?: string | null;

  @Present()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(
    PRODUCT_DECIMAL_FIELDS.weightPerUnit.scale,
    PRODUCT_DECIMAL_FIELDS.weightPerUnit.max
  )
  weightPerUnit?: number;

  @Present()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(PRODUCT_DECIMAL_FIELDS.lengthCm.scale, PRODUCT_DECIMAL_FIELDS.lengthCm.max)
  lengthCm?: number;

  @Present()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(PRODUCT_DECIMAL_FIELDS.widthCm.scale, PRODUCT_DECIMAL_FIELDS.widthCm.max)
  widthCm?: number;

  @Present()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(PRODUCT_DECIMAL_FIELDS.heightCm.scale, PRODUCT_DECIMAL_FIELDS.heightCm.max)
  heightCm?: number;
}
