import { ERROR_CODES, type ErrorCode } from "@platform/types";

/**
 * WHICH IDENTITY WAS ALREADY TAKEN — named, not hidden.
 *
 * FOUR IDENTITIES ARE UNIQUE ON THIS PLATFORM, by the owner's rule:
 * the commercial registration number, the email address, the mobile
 * number and the tax registration number. One value, one company.
 *
 * THE DATABASE DECIDES, NOT A LOOK-UP. There is deliberately no
 * pre-check that reads the row first: a pre-check is a second, racier
 * oracle answering the same question, and two concurrent requests for
 * the same identity would both pass it. The unique constraint is the
 * only authority, and this function reads its verdict — Prisma reports
 * the constraint that fired in `meta.target`, which names COLUMNS and
 * never values, so no address or number passes through here.
 *
 * WHAT THIS CHANGED, AND WHAT IT COST. Every conflict used to answer
 * identically — one code, one sentence — so that registration could
 * not be used to discover which CR numbers and email addresses exist
 * on the platform. The owner weighed that and chose the clearer
 * message: «هل فهمت ما اقصد… مع تنبيه ان الرقم او الاميل مسجل مسبقا».
 * So the field is named now, and the enumeration it opens is answered
 * where it can be: registration is rate-limited like login, which it
 * never was while the answer was uninformative.
 *
 * A CONSTRAINT THIS DOES NOT RECOGNISE STAYS NEUTRAL. An unknown
 * unique index must not be guessed at — it falls back to the general
 * conflict rather than naming a field it cannot identify.
 */

/** The four identities, by the column each unique index is built on. */
const BY_COLUMN: ReadonlyArray<readonly [RegExp, ErrorCode]> = [
  [/cr_number|crNumber/i, ERROR_CODES.CR_NUMBER_TAKEN],
  [/email/i, ERROR_CODES.EMAIL_TAKEN],
  [/mobile/i, ERROR_CODES.MOBILE_TAKEN],
  [/vat_number|vatNumber/i, ERROR_CODES.VAT_NUMBER_TAKEN],
];

/** True when this is Prisma's unique-constraint failure. */
export function isUniqueViolation(
  error: unknown
): error is { code: "P2002"; meta?: { target?: unknown } } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** The columns the failed index was built on, as one searchable string. */
export function conflictedColumns(error: {
  meta?: { target?: unknown };
}): string {
  const target = error.meta?.target;
  return Array.isArray(target) ? target.join(",") : String(target ?? "");
}

/**
 * The error code for a unique violation, or the general conflict when
 * the constraint is not one of the four identities.
 */
export function identityConflictCode(error: {
  meta?: { target?: unknown };
}): ErrorCode {
  const columns = conflictedColumns(error);
  for (const [pattern, code] of BY_COLUMN) {
    if (pattern.test(columns)) return code;
  }
  return ERROR_CODES.REGISTRATION_CONFLICT;
}
