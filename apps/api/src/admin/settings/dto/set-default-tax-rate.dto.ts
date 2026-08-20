import { IsNumber, Max, Min } from "class-validator";

export class SetDefaultTaxRateDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent!: number;
}
