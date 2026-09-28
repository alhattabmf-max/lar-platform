import { IsInt, IsPositive } from "class-validator";

/**
 * The new size of the shelf.
 *
 * «المورد يستطيع تعديل المخزون صعودًا أو هبوطًا بشرط
 *  `new target_quantity >= funded_quantity + activeLocks`.»
 *
 * ABSOLUTE, NOT A DELTA. A supplier who counted forty units in the
 * warehouse means forty, and saying so as `+15` depends on both sides
 * agreeing about what the previous value was — which they will not,
 * the moment a sale lands between the screen loading and the button
 * being pressed. The floor is enforced against the row under its own
 * lock, so an absolute number can always be answered truthfully:
 * either it is at least what is spoken for, or it is refused with the
 * number that is.
 */
export class SetDirectStockDto {
  @IsInt()
  @IsPositive()
  targetQuantity!: number;
}
