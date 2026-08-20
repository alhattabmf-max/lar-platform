import { IsNumber, IsString, Max, Min, MinLength } from "class-validator";

export class SetCommissionTaxDto {
  @IsNumber() @Min(0) @Max(100)
  ratePercent!: number;

  @IsString() @MinLength(1)
  ruleCode!: string;

  @IsString() @MinLength(1)
  ruleVersion!: string;
}
