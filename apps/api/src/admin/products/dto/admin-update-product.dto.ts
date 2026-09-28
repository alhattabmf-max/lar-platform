import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { UpdateProductDto } from "../../../products/dto/update-product.dto";

/**
 * An administrator editing a supplier's product.
 *
 * IT EXTENDS THE SUPPLIER'S OWN DTO rather than restating it. Every
 * bound, every trim, and — most importantly — the three-state
 * omitted/value/null semantics come from one place. A copied field list
 * is a list that gets a limit raised on one side and forgotten on the
 * other, and the forgotten side would be the administrative one: the
 * back door into the column.
 *
 * AN ADMINISTRATOR GAINS NO FIELD THE OWNER OF THE RECORD DOES NOT
 * HAVE. Approval status, archiving and deletion are separate actions
 * with their own routes, their own confirmations and their own
 * cascades — deliberately not fields on this form.
 *
 * THE REASON IS OPTIONAL, like the one on permanent deletion and unlike
 * the ones on suspend and close. Those two take a reason because the
 * SUPPLIER is shown it — it is correspondence. This one is not shown to
 * anybody; what the audit entry needs is the before and the after, and
 * those are recorded field by field whether a note is written or not.
 */
export class AdminUpdateProductDto extends UpdateProductDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason?: string;
}
