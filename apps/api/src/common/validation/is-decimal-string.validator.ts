import { registerDecorator, ValidationOptions } from "class-validator";

const CANONICAL_DECIMAL_PATTERN = /^[0-9]+\.[0-9]{2}$/;

/** Validates a canonical non-negative decimal string like "100.00" — never a JS float. */
export function IsDecimalString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isDecimalString",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === "string" && CANONICAL_DECIMAL_PATTERN.test(value);
        },
        defaultMessage(): string {
          return `${propertyName} must be a canonical decimal string like "0.00"`;
        },
      },
    });
  };
}
