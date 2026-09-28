import { Transform } from "class-transformer";
import { IsEmail } from "class-validator";
import { normaliseEmail } from "../../common/security/email.util";

/**
 * The address a company is reached on, changed by the company itself.
 *
 * THE SAME RULE AS REGISTRATION, and deliberately the same two lines:
 * normalised BEFORE it is validated, so `@IsEmail()` judges the value
 * that will actually be stored, and the service normalises again
 * because a DTO transform protects only the callers that come through
 * this DTO. `users.email` is unique, and the index was doing nothing
 * while the column stored whatever was typed.
 */
export class ChangeEmailDto {
  @Transform(({ value }) =>
    typeof value === "string" ? normaliseEmail(value) : value,
  )
  @IsEmail()
  email!: string;
}
