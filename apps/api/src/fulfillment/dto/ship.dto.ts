import { IsString, MinLength } from "class-validator";

export class ShipDto {
  @IsString() @MinLength(1)
  carrierCode!: string;

  @IsString() @MinLength(1)
  trackingNumber!: string;
}
