import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../../common/contracts/admin-reason.constants";

/**
 * What the supplier has to fix.
 *
 * REQUIRED, and for the same reason a rejection's is: this text is the
 * only thing the supplier sees. "Your application was returned" with
 * nothing after it is a dead end — they cannot guess which of four
 * sections an administrator was looking at.
 */
export class ReturnSupplierDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reason!: string;
}
