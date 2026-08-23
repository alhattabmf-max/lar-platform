import { registerDecorator, ValidationOptions } from "class-validator";
import { DECIMAL_14_2_INTEGER_DIGITS, fitsDecimalPrecision } from "@platform/types";

/**
 * A canonical non-negative decimal string like `"100.00"` — never a JS
 * float, and never a value the column cannot hold.
 *
 * The pattern is anchored at both ends and demands EXACTLY two decimal
 * places, so every one of these is refused before it reaches any
 * arithmetic:
 *
 *   `"1e3"`, `"1E3"`     scientific notation — `new Decimal` accepts it
 *                        and it would then be stored as 1000.00
 *   `"NaN"`, `"Infinity"` `new Decimal` accepts both and produces a
 *                        value that poisons every later operation
 *                        silently rather than throwing
 *   `"-5.00"`            a negative refund is a charge
 *   `"1.005"`            a third place the column would round away
 *   `"1.5"`, `"1"`       fewer than two places; a trailing zero carries
 *                        information about scale, and dropping it is the
 *                        first step toward a value re-parsed as a float
 *   `" 1.00"`, `"1.00 "` whitespace, which `Number()` would happily eat
 *
 * MAGNITUDE is checked too. `numeric(p,s)` allows `p - s` digits before
 * the point; beyond that PostgreSQL raises `numeric field overflow`,
 * which surfaces as a 500 after the request was already accepted. The
 * default bound is `Decimal(14,2)` — the precision of every refund
 * column on the dispute path. Pass `integerDigits` for a tighter one.
 */
const CANONICAL_DECIMAL_PATTERN = /^[0-9]+\.[0-9]{2}$/;

export function IsDecimalString(
  integerDigits: number = DECIMAL_14_2_INTEGER_DIGITS,
  validationOptions?: ValidationOptions
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isDecimalString",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== "string") return false;
          if (!CANONICAL_DECIMAL_PATTERN.test(value)) return false;
          return fitsDecimalPrecision(value, integerDigits);
        },
        defaultMessage(): string {
          return `${propertyName} must be a canonical decimal string like "0.00" with at most ${integerDigits} digits before the decimal point`;
        },
      },
    });
  };
}
