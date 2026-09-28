/**
 * WHICH FIELDS THE SERVER REFUSED — as names this application already
 * knows, never as the server's own words.
 *
 * THE COMPLAINT THIS ANSWERS. A refused save showed «البيانات المُدخلة
 * غير صحيحة» and a reference number, and nothing else. The person who
 * typed the form was told that something was wrong and left to find it
 * — on a card with a dozen fields. The server DID say which one:
 * `ValidationPipe` returns `details.validationErrors`, an array like
 * `["accountHolderName must be longer than or equal to 1 characters"]`.
 * The portal threw it away.
 *
 * WHY IT THREW IT AWAY, and why that rule is kept. Those strings are
 * English developer text and can carry internal property paths;
 * `error-messages.ts` states plainly that NOTHING from a failure is
 * ever rendered. That rule is right and is not being waived here.
 *
 * SO NOTHING FROM THE SERVER IS RENDERED. What crosses is a MATCH: the
 * leading identifier of each message is compared against the closed
 * list below, and only a name already in that list survives. What the
 * screen then shows is the portal's OWN translated label for that
 * field. An unrecognised name — a field this build does not know, a
 * message in another shape, a nested path — yields nothing and the
 * caller falls back to the generic message exactly as before.
 *
 * THE THIRD NAMED FIELD, under the same rule as `failedChecks` and
 * `blockedReason` before it: a single accessor, a closed vocabulary,
 * and no general door into `details`.
 */

/**
 * Every field name this portal is prepared to name back to a person.
 *
 * IT IS DELIBERATELY THE FORM'S VOCABULARY, not the database's. A name
 * that is not on a form somebody fills in has no business appearing in
 * a sentence telling them what to fix.
 */
export const NAMEABLE_INVALID_FIELDS = [
  // «بيانات المنشأة»
  "email",
  "accountHolderName",
  "iban",
  "bankName",
  "invoicingLegalName",
  "vatNumber",
  "isVatRegistered",
  "name",
  "regionId",
  "cityId",
  "shortAddress",
  "contactName",
  "contactPhone",
  "latitude",
  "longitude",
  // Registration
  "crNumber",
  "legalName",
  "password",
  "primaryMobile1",
] as const;

export type NameableInvalidField = (typeof NAMEABLE_INVALID_FIELDS)[number];

const NAMEABLE = new Set<string>(NAMEABLE_INVALID_FIELDS);

/**
 * The fields a `VALIDATION_FAILED` envelope named, filtered to the ones
 * above and de-duplicated.
 *
 * RETURNS AN EMPTY ARRAY, NEVER A PARTIAL TRUTH. If the payload is not
 * the shape this reads, or nothing in it is recognised, the caller gets
 * nothing and shows the generic message — which is the same behaviour
 * the portal had before this existed.
 */
export function readInvalidFields(body: unknown): NameableInvalidField[] {
  if (typeof body !== "object" || body === null) return [];

  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return [];

  const { code, details } = error as { code?: unknown; details?: unknown };
  if (code !== "VALIDATION_FAILED") return [];

  if (typeof details !== "object" || details === null) return [];
  const raw = (details as { validationErrors?: unknown }).validationErrors;
  if (!Array.isArray(raw)) return [];

  const found: NameableInvalidField[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    // `class-validator` puts the property first: "field must be …".
    // Anything else — a nested path, a sentence, an object — does not
    // match the list and is dropped.
    const first = entry.trim().split(/\s+/)[0];
    if (
      first !== undefined &&
      NAMEABLE.has(first) &&
      !found.includes(first as NameableInvalidField)
    ) {
      found.push(first as NameableInvalidField);
    }
  }
  return found;
}
