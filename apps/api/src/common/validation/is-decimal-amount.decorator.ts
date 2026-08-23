import { applyDecorators } from "@nestjs/common";
import { Max, Min, ValidateBy, buildMessage, type ValidationOptions } from "class-validator";

/**
 * Bounds a numeric request field to exactly what its `Decimal(p,s)` column
 * can store.
 *
 * The same defect the opportunity price had: `@IsNumber() @IsPositive()`
 * accepts `10.0005` and `1e21`, and the column then rounds the first and
 * rejects the second. Rounding is the worse of the two — the supplier is
 * shown, and shipped against, a measurement they did not enter.
 *
 * A sibling of `IsMoneyAmount`, which is the same rule fixed at scale 2
 * with money's own ceiling. This one takes both from the caller, because
 * a product's fields are `Decimal(10,3)` and `Decimal(10,2)` and no single
 * pair covers them.
 *
 * The caller adds `@IsNumber`, `@IsPositive` and `@IsOptional` as its own
 * field needs them: this decorator says what a STORABLE value is, not
 * whether the field is required or may be negative.
 */
function IsDecimalScale(scale: number, validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: "isDecimalScale",
      constraints: [scale],
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== "number" || !Number.isFinite(value)) return false;

          // `String(n)` is the shortest round-tripping representation:
          // 10.5 reads back as "10.5", 10.0005 as "10.0005".
          const text = String(value);
          // Scientific notation has no countable scale here, and any
          // value large enough to produce it is outside the column
          // anyway. Refused explicitly rather than incidentally.
          if (/e/i.test(text)) return false;

          const fraction = text.split(".")[1];
          return fraction === undefined || fraction.length <= scale;
        },
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be a finite number with at most ${scale} decimal places`,
          validationOptions
        ),
      },
    },
    validationOptions
  );
}

/**
 * @param scale maximum decimal places the column stores
 * @param max largest value the column can hold
 */
export function IsDecimalAmount(
  scale: number,
  max: number,
  validationOptions?: ValidationOptions
) {
  return applyDecorators(
    IsDecimalScale(scale, validationOptions),
    Min(0, validationOptions),
    Max(max, validationOptions)
  );
}
