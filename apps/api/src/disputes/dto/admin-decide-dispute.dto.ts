import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
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

  // Required only for PARTIAL_REFUND — validated at the service layer
  // against the frozen financial snapshot, never trusted at face value.
  @IsOptional()
  @IsDecimalString()
  productRefundAmountInclTax?: string;

  @IsOptional()
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
