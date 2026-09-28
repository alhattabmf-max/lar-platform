import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * What the control routes accept.
 *
 * EVERY REASON IS MANDATORY AND BOUNDED. A reason is written into the
 * audit trail and, for a rejection, shown to the company — an empty one
 * is a record nobody can act on, and an unbounded one is a text column
 * an operator can paste a log file into.
 *
 * The floor of 5 characters matches the supplier-rejection rule already
 * in the product, so an operator meets one standard rather than two.
 */

const REASON_MIN = 5;
const REASON_MAX = 1000;

export class SuspendCompanyDto {
  @IsString()
  @MinLength(REASON_MIN)
  @MaxLength(REASON_MAX)
  reason!: string;
}

/**
 * Removing a company for good.
 *
 * THREE THINGS ARE REQUIRED, and each answers a different mistake:
 *
 *   `reason`       — why, for the record that outlives the company.
 *   `confirmation` — the legal name or CR number, typed out. It is the
 *                    difference between meaning to remove THIS company
 *                    and having the wrong row on screen.
 *   `totpCode`     — proof the person is present. A session says
 *                    somebody signed in; a code says they are here now.
 */
export class DeleteCompanyDto {
  @IsString()
  @MinLength(REASON_MIN)
  @MaxLength(REASON_MAX)
  reason!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  confirmation!: string;
}

/**
 * The ordinary edit.
 *
 * ONE FIELD. `crNumber` is not here — it is the identity a company signs
 * in with, and changing it on a verified company is its own route with
 * its own proof. `accountType` and `verificationStatus` are not here
 * either: the first is immutable by the schema's own rule, and the
 * second has approve, reject, suspend and reactivate.
 *
 * Nothing financial or banking-related is editable through this at all.
 */
export class UpdateCompanyDto {
  /** Everything the ordinary edit may change. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName?: string;

  /**
   * The commercial registration.
   *
   * NO SECOND FACTOR, by the console owner's decision. The rules that
   * remain are the ones that protect the DATA rather than the operator:
   * it must be unique across companies, and a VERIFIED company's
   * registration is refused — that number is what the verification was
   * issued against.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  crNumber?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  ownerEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(40)
  primaryMobile1?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(40)
  primaryMobile2?: string;

  /** Written to the audit trail beside the before and after values. */
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason?: string;
}
