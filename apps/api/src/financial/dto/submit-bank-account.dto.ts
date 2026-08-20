import { IsString, MinLength } from "class-validator";

export class SubmitBankAccountDto {
  @IsString()
  @MinLength(1)
  accountHolderName!: string;

  @IsString()
  @MinLength(1)
  bankName!: string;

  @IsString()
  @MinLength(1)
  iban!: string;
}
