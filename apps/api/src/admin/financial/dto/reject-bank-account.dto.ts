import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../../common/contracts/admin-reason.constants";

/**
 * Why a bank account was refused verification.
 *
 * REQUIRED, for the same reason as every other denial: the supplier
 * receives this text and it is the only thing telling them whether to
 * resubmit with a different document or a different account.
 */
export class RejectBankAccountDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reason!: string;
}
