import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../../common/contracts/admin-reason.constants";

/**
 * Why a product was suspended, closed or otherwise acted on.
 *
 * The minimum was 1, which accepts a single character — a bound in name
 * only. These actions can cascade to live opportunities and cancel a
 * supplier's ability to sell, so the record of why has to be readable.
 */
export class ProductAdministrativeActionDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reason!: string;
}
