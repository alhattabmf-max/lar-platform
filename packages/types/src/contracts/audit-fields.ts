/**
 * What an audit entry may show of the values that changed.
 *
 * THE PROBLEM THIS SOLVES. `audit_logs.before_data` and `after_data`
 * hold arbitrary JSON copies of rows, so they carry whatever the row
 * carried — a billing name, an e-mail address, a masked IBAN, an
 * administrator's internal note. That is why the audit projection
 * showed neither, and why the screen could say a company's status
 * changed but not what it changed FROM. Reading the trail meant opening
 * the database.
 *
 * THE ANSWER IS A CLOSED ALLOW-LIST OF FIELD NAMES, not a filter over
 * the payload. Every name here was approved deliberately, and a field
 * that is not named is not shown — including a field nobody has thought
 * about yet, added to some row next year. The default is "hidden", and
 * making something visible is a diff someone reviews.
 *
 * THREE RULES BEYOND THE LIST, each closing a way a secret could ride
 * in under an approved name:
 *
 *   1. SCALARS ONLY. A string, a number, a boolean or null. An object
 *      or an array under an allowed name is dropped — that is how a
 *      whole nested row would otherwise travel inside a field called
 *      `status`.
 *   2. BOUNDED. A value longer than `AUDIT_VALUE_MAX_LENGTH` is
 *      dropped, not truncated. These fields hold statuses, flags,
 *      rates and identifiers; a long string in one is a sign it is not
 *      the field this list approved.
 *   3. NOTHING IS DERIVED FROM THE PAYLOAD. The projection reads the
 *      allow-list and asks the payload for those names. It never walks
 *      the payload's own keys, so an unexpected key has no path to the
 *      output at all.
 *
 * WHAT IS DELIBERATELY ABSENT, and why — this list is as much a part of
 * the design as the one above:
 *
 *   · Banking detail (`ibanLast4`, `bankName`). Masked or not, this is
 *     the category the rule was written for.
 *   · Anything identifying a person or a business (`email`,
 *     `ownerEmail`, `phone`, `primaryMobile2`, `contactName`,
 *     `contactPhone`, `shortAddress`, `crNumber`, `legalName`,
 *     `invoicingLegalName`, `companyName`).
 *   · Names of any kind (`name`, `nameAr`, `nameEn`). A category rename
 *     is harmless and a company's legal name is not, and one list
 *     cannot tell them apart by the key alone — so neither is shown.
 *   · `value`. It is the payload of a settings row and can hold
 *     anything, including security configuration. The scalar rule would
 *     drop most of them; excluding the name is the guarantee that does
 *     not depend on a shape.
 *   · `ipAddress` and `userAgent` remain out of the projection
 *     entirely, unchanged: they are request metadata about a person,
 *     kept for forensics, and reaching them is a database question with
 *     its own authorisation.
 */

/**
 * The approved names, grouped by the reason each group was approved.
 *
 * The grouping is not decoration — it is what a reviewer checks a new
 * entry against. A name that does not belong to one of these five
 * reasons does not belong on this list.
 */
export const AUDIT_VISIBLE_FIELDS = {
  /** What state a record is in. */
  status: ["status", "verificationStatus", "approvalStatus"],

  /** Whether a record is switched on. */
  activation: ["isActive", "isDefault", "isMandatory", "requiresReacceptance"],

  /**
   * Commercial values that change: rates, fees, quantities and the
   * window a listing or banner runs in.
   */
  commercial: [
    "ratePercent",
    "rateBasisPoints",
    "sameCityFeeAmount",
    "sameRegionDifferentCityFeeAmount",
    "differentRegionFeeAmount",
    "quantity",
    "startsAt",
    "endsAt",
    "isVatRegistered",
  ],

  /** Where a category sits, and in what order things appear. */
  placement: ["parentId", "sortOrder", "priority"],
} as const satisfies Record<string, readonly string[]>;

export type AuditVisibleFieldGroup = keyof typeof AUDIT_VISIBLE_FIELDS;

/** Every approved name, flattened. */
export const AUDIT_VISIBLE_FIELD_NAMES: readonly string[] = Object.values(
  AUDIT_VISIBLE_FIELDS,
).flat();

/**
 * The longest value that will be shown.
 *
 * A status, a flag, a rate or a UUID all fit comfortably. Anything
 * longer is dropped rather than cut short: a truncated value in an
 * audit trail reads as the value, and half a value is worse than none.
 */
export const AUDIT_VALUE_MAX_LENGTH = 200;

/** A value simple enough to show. */
export type AuditVisibleValue = string | number | boolean | null;

/**
 * The before/after pair an entry carries, already reduced to what may
 * be shown. Empty when nothing on the allow-list changed — which is
 * the common case and is reported as "no detail", not as an error.
 */
export type AuditVisibleData = Record<string, AuditVisibleValue>;

function isShowable(value: unknown): value is AuditVisibleValue {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value === "string") return value.length <= AUDIT_VALUE_MAX_LENGTH;
  // Objects, arrays and undefined: not shown. An object under an
  // approved name is exactly the case this refuses.
  return false;
}

/**
 * Reduces a raw `before_data`/`after_data` payload to what may be
 * shown.
 *
 * DRIVEN BY THE ALLOW-LIST, never by the payload. It asks the payload
 * for each approved name in turn; it does not enumerate what the
 * payload contains. A key nobody approved therefore has no route to the
 * result even in principle.
 *
 * Returns null when nothing survives, so a caller renders "no detail"
 * rather than an empty box that looks like a value of nothing.
 */
export function auditVisibleData(payload: unknown): AuditVisibleData | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const source = payload as Record<string, unknown>;

  const out: AuditVisibleData = {};
  for (const name of AUDIT_VISIBLE_FIELD_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
    const value = source[name];
    if (!isShowable(value)) continue;
    out[name] = value;
  }

  return Object.keys(out).length > 0 ? out : null;
}
