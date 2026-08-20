import { IsEnum, IsString, MaxLength, MinLength } from "class-validator";

export enum DisputeSupplierResponseTypeDto {
  ACCEPT = "ACCEPT",
  REJECT = "REJECT",
  PARTIAL_ACCEPT = "PARTIAL_ACCEPT",
  REPLACEMENT_OFFER = "REPLACEMENT_OFFER",
}

export class SupplierRespondDto {
  @IsEnum(DisputeSupplierResponseTypeDto)
  responseType!: DisputeSupplierResponseTypeDto;

  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  description!: string;
}
