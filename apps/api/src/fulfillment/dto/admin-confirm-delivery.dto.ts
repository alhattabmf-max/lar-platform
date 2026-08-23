import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../common/contracts/admin-reason.constants";

/**
 * Why an administrator confirmed delivery on the buyer's behalf.
 *
 * This is an override: normally the trader confirms, and doing it for
 * them starts the dispute window and the payout clock on someone else's
 * order. The minimum was 1, which accepts a single character — a bound
 * in name only for the record of why the platform stepped in.
 *
 * Bounds and trimming are shared with every other administrative reason
 * so they cannot drift apart.
 */
export class AdminConfirmDeliveryDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reasonNote!: string;
}
