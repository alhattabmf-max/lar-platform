import { IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { PRODUCT_DECIMAL_FIELDS, PRODUCT_TEXT_LIMITS } from "@platform/types";
import { IsDecimalAmount } from "../../common/validation/is-decimal-amount.decorator";

/**
 * Creating a product.
 *
 * Every bound comes from `@platform/types` rather than a literal typed
 * here, so the shared `CreateProductRequest` contract a form validates
 * against and the rule the API enforces are the same value. A contract
 * test asserts the two key sets agree.
 *
 * `null` is NOT accepted anywhere on create — there is nothing yet to
 * clear. Clearing is an UPDATE concern; see `UpdateProductDto`.
 *
 * Whitespace is trimmed before length is measured, so `"   "` fails
 * `@MinLength(1)` rather than passing as a one-character name. The
 * trimmed value is what gets stored: accepting a name with leading spaces
 * and echoing it back is a difference nobody asked for.
 */
const trim = () => Transform(({ value }) => (typeof value === "string" ? value.trim() : value));

export class CreateProductDto {
  @IsUUID()
  taxonomyNodeId!: string;

  /** SOFT reference — an autocomplete source. The NAMES are authoritative. */
  @IsOptional()
  @IsUUID()
  salesUnitId?: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.salesUnitNameAr)
  salesUnitNameAr!: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.salesUnitNameEn)
  salesUnitNameEn!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(
    PRODUCT_DECIMAL_FIELDS.packageContentQuantity.scale,
    PRODUCT_DECIMAL_FIELDS.packageContentQuantity.max
  )
  packageContentQuantity?: number;

  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.packageContentUnitNameAr)
  packageContentUnitNameAr?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.packageContentUnitNameEn)
  packageContentUnitNameEn?: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.nameAr)
  nameAr!: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.nameEn)
  nameEn!: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(PRODUCT_TEXT_LIMITS.descriptionAr)
  descriptionAr?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(PRODUCT_TEXT_LIMITS.descriptionEn)
  descriptionEn?: string;

  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(
    PRODUCT_DECIMAL_FIELDS.weightPerUnit.scale,
    PRODUCT_DECIMAL_FIELDS.weightPerUnit.max
  )
  weightPerUnit!: number;

  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(PRODUCT_DECIMAL_FIELDS.lengthCm.scale, PRODUCT_DECIMAL_FIELDS.lengthCm.max)
  lengthCm!: number;

  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(PRODUCT_DECIMAL_FIELDS.widthCm.scale, PRODUCT_DECIMAL_FIELDS.widthCm.max)
  widthCm!: number;

  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(PRODUCT_DECIMAL_FIELDS.heightCm.scale, PRODUCT_DECIMAL_FIELDS.heightCm.max)
  heightCm!: number;
}
