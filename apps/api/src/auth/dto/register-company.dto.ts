import { Transform } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";
import { normaliseEmail } from "../../common/security/email.util";

/**
 * What it takes to open an account, and nothing more.
 *
 * THE BRANCH IS NOT HERE. Registration used to demand a city, a short
 * address and a pair of coordinates before it would create anything —
 * so somebody who had not yet decided where they would operate from
 * could not have an account at all. A branch is now added afterwards,
 * from "complete your profile", against the endpoint that already
 * exists for it.
 *
 * NO DEFAULT BRANCH IS INVENTED to fill the gap. A row nobody typed is
 * a row nobody can be held to, and an address the platform made up is
 * worse than no address.
 */

export class RegisterCompanyDto {
  @IsString()
  @MinLength(1)
  crNumber!: string;

  @IsString()
  @MinLength(1)
  legalName!: string;

  /**
   * NORMALISED BEFORE IT IS VALIDATED, and again in the service.
   *
   * `users.email` is unique, and the index was doing nothing: the
   * column stored whatever was typed, so `owner@x.com`, `Owner@X.com`
   * and ` owner@x.com ` were three accounts. Trimming and lower-casing
   * here means `@IsEmail()` judges the value that will actually be
   * stored — and the service normalises again, because a DTO transform
   * protects only the callers that go through this DTO.
   */
  @Transform(({ value }) =>
    typeof value === "string" ? normaliseEmail(value) : value,
  )
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /**
   * ONE NUMBER, AND IT IS REQUIRED.
   *
   * Registration used to demand two mobiles and a contact person's
   * name before an account could exist. A company signing up has one
   * number it wants to be reached on; the second number and the named
   * contact are a DETAIL of the company's record, and they are
   * collected — optionally, and as a pair — from "company details"
   * inside the portal.
   */
  @IsString()
  @MinLength(1)
  primaryMobile1!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("4", { each: true })
  acceptedPolicyVersionIds!: string[];
}
