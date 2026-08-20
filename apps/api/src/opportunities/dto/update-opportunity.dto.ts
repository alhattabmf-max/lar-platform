import { IsDateString, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from "class-validator";

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

  @IsOptional()
  @IsNumber()
  @IsPositive()
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
