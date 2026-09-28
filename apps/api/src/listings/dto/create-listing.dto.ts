import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { PRODUCT_DECIMAL_FIELDS, PRODUCT_TEXT_LIMITS } from "@platform/types";
import { IsDecimalAmount } from "../../common/validation/is-decimal-amount.decorator";
import { IsMoneyAmount } from "../../common/validation/is-money-amount.decorator";

/**
 * ONE LISTING, which is what the supplier calls a product.
 *
 * There is no "opportunity" in this vocabulary and no second step. What
 * arrives here is a single form: what the thing IS, and the terms it is
 * being sold on. The service splits it across the two rows that already
 * exist — a catalogue row whose identity is frozen into a snapshot at
 * publish time, and an offer row that carries the pinned economics the
 * orders hang off. That split is not a leftover: it is the only reason
 * a supplier can correct a typo without rewriting what somebody bought
 * last month.
 *
 * MULTIPART, so the image travels with the fields rather than after
 * them. Every value therefore arrives as a STRING — `@Transform` is not
 * decoration here, it is the difference between `"12"` and `12`, and
 * without it every numeric rule below would reject a valid form.
 *
 * EVERY BOUND COMES FROM THE SHARED CONTRACT. A limit retyped here is a
 * limit that drifts from the one the form validates against.
 */
const trim = () => Transform(({ value }) => (typeof value === "string" ? value.trim() : value));

/**
 * A number that arrived as text.
 *
 * An empty string becomes `undefined` rather than `NaN`, so an optional
 * field left blank in a multipart body reads as absent — which is what
 * the browser sends and what `@IsOptional` expects.
 */
const asNumber = () =>
  Transform(({ value }) => {
    if (value === "" || value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  });

/** An optional string that was left blank in the form. */
const asOptionalText = () =>
  Transform(({ value }) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  });

export class CreateListingDto {
  // ------------------------------------------------------------ what it is
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

  /**
   * THE LEAF, not the root. A taxonomy that has children is never a
   * valid answer — the service refuses it rather than storing a
   * half-classified product, because "أدوات" tells a buyer nothing that
   * "أدوات ← مفكات" does not tell them better.
   */
  @IsUUID()
  taxonomyNodeId!: string;

  @asOptionalText()
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_TEXT_LIMITS.descriptionAr)
  descriptionAr?: string;

  @asOptionalText()
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_TEXT_LIMITS.descriptionEn)
  descriptionEn?: string;

  // ------------------------------------------------------- how it is sold
  /** SOFT reference — an autocomplete source. The NAMES are authoritative. */
  @asOptionalText()
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

  // ----------------------------------------------------------- the terms
  @asNumber()
  @IsNumber()
  @IsPositive()
  @IsMoneyAmount()
  unitPriceAmount!: number;

  @asNumber()
  @IsInt()
  @IsPositive()
  targetQuantity!: number;

  @IsUUID()
  fulfillmentLocationId!: string;

  /**
   * HOW LONG THE OFFER RUNS, in days — not when it starts and ends.
   *
   * A supplier picking two calendar dates was being asked to answer a
   * question they do not think in: they know "a week", not "the 27th at
   * 14:05 until the 3rd at 14:05". The window is stamped at
   * PUBLICATION — start is the moment it goes on sale, end is that
   * moment plus this many days — so what a buyer sees counting down is
   * measured from when the thing actually became buyable, not from when
   * the form was filled in.
   *
   * The stored columns are unchanged: two real timestamps, because an
   * order's deadlines and every sweep hang off them. This is the input,
   * not the storage.
   */
  @asNumber()
  @IsInt()
  @IsPositive()
  offerDurationDays!: number;

  /**
   * NOT COSMETIC. This reaches `order_allocations.preparation_due_at` —
   * the deadline a supplier is held to on an order. It is asked for
   * rather than defaulted silently, because a default nobody saw is a
   * commitment nobody made.
   */
  @asNumber()
  @IsInt()
  @IsPositive()
  expectedPreparationDays!: number;

  // ------------------------------------------------- what the carrier needs
  /**
   * WEIGHT AND THE THREE DIMENSIONS. Shipping companies price on them,
   * so they are required — not platform bookkeeping.
   */
  @asNumber()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(
    PRODUCT_DECIMAL_FIELDS.weightPerUnit.scale,
    PRODUCT_DECIMAL_FIELDS.weightPerUnit.max
  )
  weightPerUnit!: number;

  @asNumber()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(PRODUCT_DECIMAL_FIELDS.lengthCm.scale, PRODUCT_DECIMAL_FIELDS.lengthCm.max)
  lengthCm!: number;

  @asNumber()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(PRODUCT_DECIMAL_FIELDS.widthCm.scale, PRODUCT_DECIMAL_FIELDS.widthCm.max)
  widthCm!: number;

  @asNumber()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(PRODUCT_DECIMAL_FIELDS.heightCm.scale, PRODUCT_DECIMAL_FIELDS.heightCm.max)
  heightCm!: number;

  // ------------------------------------------------- the package group
  /**
   * WHAT IS INSIDE THE UNIT BEING SOLD, and it is REQUIRED here.
   *
   * The owner made it so. The catalogue route it shares a table with
   * still accepts none of the three — that route serves the admin
   * surface and every product created before this rule existed, and
   * tightening it would refuse rows the platform already holds. The
   * rule belongs to the form that is being filled in NOW.
   */
  @asNumber()
  @IsNumber()
  @IsPositive()
  @IsDecimalAmount(
    PRODUCT_DECIMAL_FIELDS.packageContentQuantity.scale,
    PRODUCT_DECIMAL_FIELDS.packageContentQuantity.max
  )
  packageContentQuantity!: number;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.packageContentUnitNameAr)
  packageContentUnitNameAr!: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_TEXT_LIMITS.packageContentUnitNameEn)
  packageContentUnitNameEn!: string;
}
