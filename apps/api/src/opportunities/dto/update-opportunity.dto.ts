import { IsDateString, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from "class-validator";
import { IsMoneyAmount } from "../../common/validation/is-money-amount.decorator";

export class UpdateOpportunityDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  fulfillmentLocationId?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  targetQuantity?: number;

  /**
   * The SAME constraints as on create, from the same decorator.
   *
   * An edit that could set a price the create path refuses would be a
   * back door into the column, and a copied rule is one that gets
   * tightened on one side and forgotten on the other.
   */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @IsMoneyAmount()
  unitPriceAmount?: number;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  expectedPreparationDays?: number;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string;
}
