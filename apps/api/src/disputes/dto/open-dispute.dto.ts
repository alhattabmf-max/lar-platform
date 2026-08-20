import { IsEnum, IsOptional, IsString, MaxLength, MinLength, IsArray, ArrayMaxSize } from "class-validator";

export enum DisputeReasonCodeDto {
  ITEM_NOT_RECEIVED = "ITEM_NOT_RECEIVED",
  ITEM_DAMAGED = "ITEM_DAMAGED",
  ITEM_INCORRECT = "ITEM_INCORRECT",
  QUANTITY_SHORTAGE = "QUANTITY_SHORTAGE",
  QUALITY_ISSUE = "QUALITY_ISSUE",
  OTHER = "OTHER",
}

export class OpenDisputeDto {
  @IsEnum(DisputeReasonCodeDto)
  reasonCode!: DisputeReasonCodeDto;

  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  evidenceStorageObjectKeys?: string[];
}
