import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * A NOTE THE CALLER MAY LEAVE, NOT ONE THE PLATFORM DEMANDS.
 *
 * «بدون أن يطلب مني سبب لذلك… حذف بس يعطيني بعد ما أضغط حذف تأكيد
 * الحذف.»
 *
 * WHY THE OTHER ACTIONS DEMAND ONE AND THIS DOES NOT. A suspension, a
 * rejection or a closure is a decision somebody ELSE reads afterwards —
 * the supplier whose listing stopped, the operator who inherits the
 * case. The sentence is part of the act. A permanent delete is the
 * owner removing his own row, and there is no second reader.
 *
 * THE AUDIT ENTRY IS NOT WEAKENED BY THIS. It still records who, when,
 * from which address, and — because nothing will be left to join an id
 * to — the product's own name, status and offer count. Only the WHY may
 * now be blank.
 *
 * AND IT IS STILL BOUNDED WHEN GIVEN, at the same length every other
 * administrative note is, so an optional field cannot become an
 * unbounded string in a table kept indefinitely.
 */
export class OptionalReasonDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason?: string;
}
