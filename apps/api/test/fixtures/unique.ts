import { randomUUID } from "node:crypto";

/**
 * UNIQUE IDENTITIES FOR A SUITE THAT SHARES ONE DATABASE.
 *
 * These tests do not each get a clean database. They run against one
 * Postgres, in parallel workers, and they leave their rows behind — so
 * anything written into a UNIQUE column has to be unique across every
 * spec, every worker, AND every past run still sitting in the table.
 *
 * WHAT WENT WRONG WITHOUT THIS. Fifty-two places wrote the literal
 * `+966500000001`, and thirty wrote the same two VAT numbers. That was
 * harmless until `20260830000100_identity_uniqueness` put unique indexes
 * on `users.primary_mobile_1`, `supplier_tax_profiles.vat_number` and
 * `trader_tax_profiles.vat_number` — on the owner's own instruction.
 * From that migration onward the SECOND spec to seed either failed with
 *
 *   Unique constraint failed on the fields: (`primary_mobile_1`)
 *   Unique constraint failed on the fields: (`vat_number`)
 *
 * and, being a seed failure, took its whole file down before a single
 * assertion ran. A real defect hid behind that noise: `AWAITING_FUNDING`
 * was missing from a CHECK constraint, and the one spec that asserts
 * that status could never reach the line that would have caught it.
 *
 * WHY ONE HELPER AND NOT A FIX PER FILE. Twenty local fixes are twenty
 * chances to pick a scheme that collides with one of the other
 * nineteen. One source of unique values cannot collide with itself.
 *
 * HOW UNIQUENESS IS ACTUALLY GUARANTEED. A timestamp is not enough: two
 * workers start in the same millisecond. A counter is not enough: it
 * restarts at zero in every process, and yesterday's rows are still in
 * the table. `Math.random()` is a probability, not a guarantee, and a
 * short slice of it is a small probability.
 *
 * So every value carries BOTH:
 *
 *   a UUID's entropy — 122 bits, from the platform's own CSPRNG, which
 *                      settles collisions across processes and across
 *                      every run that ever left a row behind;
 *   a process counter — which settles the one case entropy cannot be
 *                      asked about twice in the same instant: two calls
 *                      so close together that nothing else has moved.
 *
 * THE SHAPES ARE REAL. A number the platform would reject is a fixture
 * testing a case production never sees, so a mobile still begins `+9665`
 * and a VAT number is still fifteen digits — `SAUDI_VAT_NUMBER_PATTERN`
 * is `/^\d{15}$/` in three services.
 */

let counter = 0;

/** Digits only, from a UUID's entropy — never `Math.random()`. */
function entropyDigits(howMany: number): string {
  let digits = "";
  while (digits.length < howMany) digits += randomUUID().replace(/\D/g, "");
  return digits.slice(0, howMany);
}

/**
 * The part that makes two calls in the same instant differ.
 *
 * Three digits is enough: it only has to separate calls that the
 * entropy above has already made astronomically unlikely to clash.
 */
function nextCount(): string {
  counter += 1;
  return String(counter % 1000).padStart(3, "0");
}

/**
 * A Saudi mobile: `+9665` and then digits.
 *
 * LONGER THAN A REAL NUMBER, AND DELIBERATELY. The column has no format
 * constraint and the DTO only bounds the length (`@MinLength(7)
 * @MaxLength(40)`), so the choice here is between a fixture that LOOKS
 * right and one that cannot collide. A duplicate is a test that fails
 * for a reason having nothing to do with its subject, which is worse
 * than a number with too many digits in it.
 *
 * THE PREFIX IS KEPT because assertions depend on it: several specs
 * check that an audit payload does NOT contain `+9665`, which is how
 * they prove a phone number never leaked into a log.
 */
export function uniqueMobile(): string {
  return `+9665${nextCount()}${entropyDigits(11)}`;
}

/**
 * A second number for the same user. `primary_mobile_2` carries no
 * unique index today, but a row whose two numbers are identical is not
 * a row anybody would register.
 */
export function uniqueSecondMobile(): string {
  return uniqueMobile();
}

/** A commercial registration number nobody else holds. */
export function uniqueCrNumber(prefix = "CR"): string {
  return `${prefix}-${nextCount()}${entropyDigits(12)}`;
}

/** An email address nobody else holds. */
export function uniqueEmail(prefix = "test"): string {
  return `${prefix}-${nextCount()}${entropyDigits(10)}@example.com`;
}

/**
 * A VAT number that is EXACTLY fifteen digits, and that no other caller
 * will produce.
 *
 * FIFTEEN IS NOT A STYLE CHOICE. Three services check
 * `SAUDI_VAT_NUMBER_PATTERN = /^\d{15}$/`, and the database checks it
 * again — `trader_tax_profiles_vat_number_format` is
 * `vat_number ~ '^[0-9]{15}$'`. A sixteen-digit fixture is refused by
 * Postgres itself, which is how the first version of this function
 * announced its own off-by-one.
 *
 * Saudi VAT numbers begin and end with 3; the thirteen digits between
 * them carry the counter and the entropy: 1 + 3 + 10 + 1 = 15.
 */
export function uniqueVatNumber(): string {
  return `3${nextCount()}${entropyDigits(10)}3`;
}
