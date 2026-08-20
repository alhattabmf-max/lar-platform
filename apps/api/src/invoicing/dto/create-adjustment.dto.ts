import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from "class-validator";

export class CreateAdjustmentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  sourceDescription!: string;

  @IsOptional()
  @IsString()
  sourceReferenceId?: string;
}
