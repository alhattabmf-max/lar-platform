import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../../common/contracts/admin-reason.constants";

/**
 * Why a supplier's verification was refused.
 *
 * REQUIRED. It was optional, and the controller passed
 * "No reason provided" when it was omitted — a sentence written by the
 * code, stored in the audit log, and indistinguishable from one an
 * administrator typed. A supplier told only that they were rejected has
 * nothing to correct and nothing to appeal.
 */
export class RejectSupplierDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reason!: string;
}
