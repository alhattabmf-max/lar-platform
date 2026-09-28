import { IsString, MinLength } from "class-validator";

/**
 * The payout account, as a supplier submits it.
 *
 * THE BANK IS NOT ON THIS FORM. It used to be free text beside the
 * IBAN, which meant two things could disagree about one fact — a
 * supplier could type an Al Rajhi IBAN and "Riyad Bank" above it, and
 * the platform would store both. The number already names the bank, so
 * the server reads it out and the form shows what it read.
 *
 * Sending a `bankName` is therefore rejected by the global
 * `forbidNonWhitelisted` pipe, which is the intended answer: there is
 * one source for this fact and it is the IBAN.
 */
export class SubmitBankAccountDto {
  @IsString()
  @MinLength(1)
  accountHolderName!: string;

  @IsString()
  @MinLength(1)
  iban!: string;
}
