import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../../common/contracts/admin-reason.constants";

/**
 * Why a product was refused approval.
 *
 * REQUIRED. It is written onto the product as `rejectionReason` and is
 * what the supplier sees on their own screen — the one field that tells
 * them what to fix before submitting again.
 */
export class RejectProductDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reason!: string;
}
