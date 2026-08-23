import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { IsDecimalString } from "../../common/validation/is-decimal-string.validator";

export enum DisputeDecisionTypeDto {
  FULL_REFUND = "FULL_REFUND",
  PARTIAL_REFUND = "PARTIAL_REFUND",
  REJECTED = "REJECTED",
  REPLACEMENT = "REPLACEMENT",
}

export class AdminDecideDisputeDto {
  @IsEnum(DisputeDecisionTypeDto)
  decisionType!: DisputeDecisionTypeDto;

  /**
   * Required only for PARTIAL_REFUND, and validated against the frozen
   * financial snapshot in the service — never trusted at face value.
   *
   * `@ValidateIf(… !== undefined)` rather than `@IsOptional()`, because
   * `@IsOptional()` skips validation for `null` as well as `undefined`.
   * A caller sending `productRefundAmountInclTax: null` therefore passed
   * validation, slipped past the service's `=== undefined` guard, and
   * reached the Decimal parser — which throws, producing a 500 for what
   * is plainly a bad request. `@ValidateIf` lets `undefined` through and
   * makes `null` fail here, with a 400 that names the field.
   */
  @ValidateIf((object: AdminDecideDisputeDto) => object.productRefundAmountInclTax !== undefined)
  @IsDecimalString()
  productRefundAmountInclTax?: string;

  @ValidateIf((object: AdminDecideDisputeDto) => object.shippingRefundAmount !== undefined)
  @IsDecimalString()
  shippingRefundAmount?: string;

  // Required only for REPLACEMENT.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  replacementQuantity?: number;

  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reasonNote!: string;
}
