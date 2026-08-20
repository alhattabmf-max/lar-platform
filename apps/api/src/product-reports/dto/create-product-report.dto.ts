import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { ProductReportReasonCode } from "@prisma/client";

class ReportEvidenceItemDto {
  @IsString()
  @MinLength(1)
  objectKey!: string;

  @IsString()
  @MinLength(1)
  contentType!: string;

  @IsInt()
  @IsPositive()
  sizeBytes!: number;
}

export class CreateProductReportDto {
  @IsUUID()
  productId!: string;

  @IsEnum(ProductReportReasonCode)
  reasonCode!: ProductReportReasonCode;

  @ValidateIf((o) => o.reasonCode === ProductReportReasonCode.OTHER)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @IsOptional()
  reasonDetails?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReportEvidenceItemDto)
  evidence?: ReportEvidenceItemDto[];
}
