import { IsDateString, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from "class-validator";
import { IsMoneyAmount } from "../../common/validation/is-money-amount.decorator";

export class CreateOpportunityDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  fulfillmentLocationId!: string;

  @IsInt()
  @IsPositive()
  targetQuantity!: number;

  /**
   * Tax-inclusive price per selling unit.
   *
   * `IsMoneyAmount` is shared with `UpdateOpportunityDto` so the two
   * cannot drift: it bounds the value to what `Decimal(12,2)` can hold and
   * refuses anything with more than two decimal places, scientific
   * notation, `NaN` or `Infinity`. Rounding a third decimal away silently
   * would charge on a price the supplier did not enter.
   */
  @IsNumber()
  @IsPositive()
  @IsMoneyAmount()
  unitPriceAmount!: number;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsInt()
  @IsPositive()
  expectedPreparationDays!: number;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string;
}
