import { IsDateString, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from "class-validator";

export class CreateOpportunityDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  fulfillmentLocationId!: string;

  @IsInt()
  @IsPositive()
  targetQuantity!: number;

  @IsNumber()
  @IsPositive()
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
