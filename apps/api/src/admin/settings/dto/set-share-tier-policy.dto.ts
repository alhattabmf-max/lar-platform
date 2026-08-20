import { Type } from "class-transformer";
import { IsArray, IsInt, IsNumber, IsOptional, IsPositive, Max, Min, ValidateNested } from "class-validator";

class ShareTierDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxTotalValueInclTax?: number | null;

  @IsInt()
  @Min(1)
  @Max(10000)
  shareBasisPoints!: number;
}

export class SetShareTierPolicyDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShareTierDto)
  tiers!: ShareTierDto[];
}
