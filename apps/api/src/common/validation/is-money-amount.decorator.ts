import { applyDecorators } from "@nestjs/common";
import { Max, Min, ValidateBy, buildMessage, type ValidationOptions } from "class-validator";

/**
 * The largest value a `Decimal(12,2)` column can hold.
 *
 * Twelve significant digits, two of them after the point. A request above
 * this is rejected here, with a message naming the limit, rather than
 * reaching Postgres and coming back as a numeric-overflow error nobody
 * outside the team can act on.
 */
export const MONEY_COLUMN_MAX = 9_999_999_999.99;

/** Scale of every money column in this system. */
export const MONEY_COLUMN_SCALE = 2;

/**
 * Rejects a number that carries more precision than the column can store.
 *
 * Written against the value's shortest round-tripping representation,
 * which is what `String(n)` gives: `115.155` reads back as `"115.155"`
 * and is refused, while `115.15` reads back as `"115.15"` and passes.
 * Silently rounding it instead would mean the supplier is shown, and
 * charged on, a price they did not enter.
 *
 * Scientific notation is refused outright. `1e21` stringifies as `"1e+21"`
 * and has no meaningful scale to count; it is also far outside the
 * column, so `Max` would reject it anyway — this makes the refusal
 * explicit rather than incidental.
 *
 * `NaN` and `Infinity` are refused here too. `@IsNumber()` alone accepts
 * neither by default, but this validator must not depend on the order
 * decorators happen to run in.
 */
function IsMoneyScale(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: "isMoneyScale",
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== "number" || !Number.isFinite(value)) return false;

          const text = String(value);
          if (/e/i.test(text)) return false;

          const fraction = text.split(".")[1];
          return fraction === undefined || fraction.length <= MONEY_COLUMN_SCALE;
        },
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be a finite amount with at most ${MONEY_COLUMN_SCALE} decimal places`,
          validationOptions
        ),
      },
    },
    validationOptions
  );
}

/**
 * Every constraint a money field in a request body must satisfy.
 *
 * Composed once and applied by both `CreateOpportunityDto` and
 * `UpdateOpportunityDto`, so the two cannot drift — a copied rule is one
 * that gets tightened on one side and forgotten on the other.
 *
 * `@IsNumber` with `allowNaN`/`allowInfinity` left at their defaults
 * (false) is the first line; `IsMoneyScale` re-checks finiteness anyway.
 *
 * The caller supplies `@IsPositive` or `@IsOptional` as it needs them —
 * this decorator says what a money VALUE is, not whether the field is
 * required.
 */
export function IsMoneyAmount(validationOptions?: ValidationOptions) {
  return applyDecorators(
    IsMoneyScale(validationOptions),
    Min(0, validationOptions),
    Max(MONEY_COLUMN_MAX, validationOptions)
  );
}
