import { IsNumber, Min } from "class-validator";

export class SetShippingTariffDto {
  @IsNumber() @Min(0)
  sameCityFeeAmount!: number;

  @IsNumber() @Min(0)
  sameRegionDifferentCityFeeAmount!: number;

  @IsNumber() @Min(0)
  differentRegionFeeAmount!: number;
}
