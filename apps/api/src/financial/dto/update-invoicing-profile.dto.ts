import { IsString, MinLength } from "class-validator";

export class UpdateInvoicingProfileDto {
  @IsString()
  @MinLength(1)
  invoicingLegalName!: string;
}
