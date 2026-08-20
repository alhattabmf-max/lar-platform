/**
 * Naming policy documents.
 *
 * A PolicyDocument has a `code`, not a title — there is no title column
 * anywhere in the schema — so a display name has to come from this app's
 * message catalogue. That means the set of names is closed, and a
 * document code nobody has translated yet must fall back to the code
 * itself rather than to a fabricated title or an empty string.
 *
 * Shared between registration (where each code labels a consent
 * checkbox) and the public viewer (where it heads a section), so the
 * two can never call the same document by different names.
 */
export const KNOWN_POLICY_DOCUMENT_CODES = ["terms_of_service", "privacy_policy"] as const;

export type KnownPolicyDocumentCode = (typeof KNOWN_POLICY_DOCUMENT_CODES)[number];

export function isKnownPolicyDocumentCode(code: string): code is KnownPolicyDocumentCode {
  return (KNOWN_POLICY_DOCUMENT_CODES as readonly string[]).includes(code);
}

/**
 * Resolves a code to a display name.
 *
 * `translate` is passed in rather than imported so this stays a pure
 * function usable from either a server or a client component, and
 * testable without a translation runtime.
 */
export function policyDocumentLabel(
  code: string,
  translate: (key: KnownPolicyDocumentCode) => string
): string {
  return isKnownPolicyDocumentCode(code) ? translate(code) : code;
}
