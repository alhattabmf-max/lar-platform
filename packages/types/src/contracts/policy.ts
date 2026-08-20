/**
 * Public policy contract.
 *
 * `GET /policies/active` serves two callers with different needs from
 * one shape: registration, which must list every mandatory policy and
 * collect an acceptance for each, and the public policies viewer, which
 * must display the full text to someone who has not signed in.
 *
 * `documentCode` is the stable identity of the DOCUMENT (e.g.
 * `terms_of_service`), distinct from the version's own id. It is the
 * only label available — a policy document has a code, not a title — so
 * a viewer either translates a code it recognises or shows the code
 * itself. It must never fabricate a title.
 *
 * Deliberately absent: `isPublished` (always true for everything
 * returned, so it carries no information), `requiresReacceptance` (an
 * internal re-consent mechanic, not something an anonymous reader acts
 * on), `policyDocumentId`, `createdAt` and `updatedAt`.
 */
export interface PublicPolicyVersion {
  /** The VERSION id — this is what an acceptance references. */
  id: string;
  /** Stable document identity, e.g. "terms_of_service". Never a display title. */
  documentCode: string;
  /** Publisher-assigned, e.g. "v2.1". Shown verbatim. */
  versionLabel: string;
  textAr: string;
  textEn: string;
  /** Mandatory policies must all be accepted before registration succeeds. */
  isMandatory: boolean;
  /** ISO 8601, or null if the row was published without a stamped time. */
  publishedAt: string | null;
}

export const PUBLIC_POLICY_VERSION_KEYS = [
  "id",
  "documentCode",
  "versionLabel",
  "textAr",
  "textEn",
  "isMandatory",
  "publishedAt",
] as const satisfies readonly (keyof PublicPolicyVersion)[];
