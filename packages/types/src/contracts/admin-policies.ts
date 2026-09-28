/**
 * Authoring the platform's legal documents.
 *
 * WHAT ALREADY EXISTED. `policy_documents`, `policy_versions` and
 * `policy_acceptances` have been in the schema and in use all along:
 * registration refuses to complete unless every mandatory published
 * version is accepted, the public viewer renders them, and acceptances
 * are recorded against a version id. What did not exist was any way to
 * WRITE them. The two documents in the database carry seventy characters
 * of placeholder text apiece, published, accepted by everyone who has
 * registered — and no screen or endpoint could replace a word of it.
 *
 * A DOCUMENT HAS NO TITLE COLUMN. `PolicyDocument` carries a `code` and
 * nothing else, so a display name comes from the message catalogue by
 * code. That is why `documentCode` travels on every shape here: it is
 * the document's identity AND the only thing a screen can name it by.
 *
 * A VERSION IS NEVER EDITED ONCE PUBLISHED. People accepted that exact
 * text, and `policy_acceptances` points at its id; changing the words
 * underneath would rewrite what a hundred and fifty people agreed to.
 * Editing is therefore only ever offered on a draft, and a change to
 * published text is a NEW version.
 *
 * ONE PUBLISHED VERSION PER DOCUMENT. The public viewer renders every
 * published row and registration demands acceptance of every mandatory
 * published row, so two live versions of the terms would show the
 * document twice and ask for two consents to one thing. Publishing
 * withdraws the previous version in the same transaction.
 */

/** The two documents this platform knows how to name. */
export const KNOWN_POLICY_CODES = ["terms_of_service", "privacy_policy"] as const;
export type KnownPolicyCode = (typeof KNOWN_POLICY_CODES)[number];

/**
 * What a document code may look like.
 *
 * Lower-case, underscore-separated, because the code is also the public
 * anchor (`terms_of_service` becomes `#policy-terms-of-service`) and
 * appears in an address bar.
 */
export const POLICY_CODE_PATTERN = /^[a-z][a-z0-9_]{2,48}$/;

/** One authored version, as the console reads it. */
export interface AdminPolicyVersion {
  id: string;
  versionLabel: string;
  textAr: string;
  textEn: string;
  isPublished: boolean;
  isMandatory: boolean;
  requiresReacceptance: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * How many people have accepted this exact version.
   *
   * The reason a version cannot be deleted, shown rather than implied:
   * an operator looking at "158 acceptances" does not need to be told
   * separately why the delete button is absent.
   */
  acceptanceCount: number;
}

export const ADMIN_POLICY_VERSION_KEYS = [
  "id",
  "versionLabel",
  "textAr",
  "textEn",
  "isPublished",
  "isMandatory",
  "requiresReacceptance",
  "publishedAt",
  "createdAt",
  "updatedAt",
  "acceptanceCount",
] as const satisfies readonly (keyof AdminPolicyVersion)[];

/** One document and everything ever written for it. */
export interface AdminPolicyDocument {
  id: string;
  code: string;
  createdAt: string;
  /** Newest first. */
  versions: AdminPolicyVersion[];
}

export const ADMIN_POLICY_DOCUMENT_KEYS = [
  "id",
  "code",
  "createdAt",
  "versions",
] as const satisfies readonly (keyof AdminPolicyDocument)[];

/** The bounds the API enforces on authored text. */
export const POLICY_TEXT_MIN = 20;
export const POLICY_TEXT_MAX = 200_000;
export const POLICY_VERSION_LABEL_MAX = 60;
