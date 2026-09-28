import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../common/contracts/admin-reason.constants";

/**
 * Why an administrator replaced the billing identity captured on an
 * order with the buyer's current tax profile.
 *
 * This rewrites what appears on a tax-adjacent document, so the record
 * of why is the whole safeguard. The minimum was 1 — a bound in name
 * only, on the one field that explains the change to whoever reads the
 * order a year from now.
 *
 * Bounds and trimming are shared with every other administrative reason
 * so they cannot drift apart. The body carries NOTHING ELSE: the
 * override always copies the trader's current `TraderTaxProfile`
 * verbatim, and an administrator can never type a VAT number or a legal
 * name into it.
 */
export class CreateBuyerBillingOverrideDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reasonNote!: string;
}
