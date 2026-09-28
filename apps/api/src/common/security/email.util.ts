/**
 * ONE SPELLING OF AN ADDRESS, everywhere it is used as an identity.
 *
 * WHAT WENT WRONG WITHOUT IT. `users.email` has carried a UNIQUE index
 * since the first migration, and it did nothing: the column stored
 * whatever was typed, so `owner@x.com`, `Owner@X.com` and
 * ` owner@x.com ` were three different values and three different
 * accounts. Reproduced against the development database — the same
 * address registered twice as a buyer and once as a supplier, all
 * accepted, all 201.
 *
 * THE DATABASE STILL DECIDES. This does not replace the unique index;
 * it makes it mean what it was always supposed to mean. Every write and
 * every lookup passes through here, so the index compares like with
 * like and a duplicate is refused by PostgreSQL rather than by a check
 * two requests can race past.
 *
 * LOWER-CASING THE WHOLE ADDRESS IS DELIBERATE, and it is a decision
 * rather than an oversight. The local part of an address is
 * case-SENSITIVE by RFC 5321, so `Owner@x.com` and `owner@x.com` may in
 * principle be two mailboxes. No mail provider a Saudi company uses
 * treats them as two, and the alternative — accepting both as separate
 * accounts — is the defect being fixed. Every large platform makes the
 * same trade.
 *
 * IT IS NOT VALIDATION. A value that is not an address at all comes
 * back unchanged and is refused by `@IsEmail()`, which is where that
 * judgement belongs.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether two addresses are the same identity.
 *
 * Written out rather than left to each caller, so nobody compares a
 * raw value against a normalised one and concludes they differ.
 */
export function sameEmailIdentity(a: string, b: string): boolean {
  return normaliseEmail(a) === normaliseEmail(b);
}
