import { Transform } from "class-transformer";
import { IsEmail } from "class-validator";
import { normaliseEmail } from "../../common/security/email.util";

export class ForgotPasswordDto {
  /**
   * NORMALISED, so recovery finds the account.
   *
   * Registration stores the address in one spelling; a reset request
   * typed in another would look up a value that is not there and answer
   * "if that address exists we have sent a link" to somebody whose
   * address does exist. The lookup and the stored value have to be the
   * same shape.
   */
  @Transform(({ value }) =>
    typeof value === "string" ? normaliseEmail(value) : value,
  )
  @IsEmail()
  email!: string;
}
