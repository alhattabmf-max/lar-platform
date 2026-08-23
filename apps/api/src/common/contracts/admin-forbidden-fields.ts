/**
 * Internal column names that must never reach an admin response.
 *
 * SERVER-SIDE ONLY, and that is the point. These lists were briefly in
 * `@platform/types`, which meant a catalogue of the platform's most
 * sensitive column names was compiled into the browser bundle — an
 * inventory of exactly what to look for, handed to anyone who opens
 * devtools. The lists are a TESTING instrument, not a contract: the
 * contracts express what a response *does* carry, and these express what
 * no response may.
 *
 * The same reasoning removed `SETTLEMENT_FORBIDDEN_FIELDS` from the
 * shared package in 8E.1.
 *
 * Nothing at runtime reads these. They exist for the specs that assert
 * absence, and absence is enforced by the `select` clauses themselves —
 * not selecting is stronger than not mapping.
 */

/** Never on ANY admin response, whatever the surface. */
export const ADMIN_FORBIDDEN_FIELDS = [
  "passwordHash",
  "twoFactorSecretEncrypted",
  "codeHash",
  "ibanCiphertext",
  "ibanFingerprint",
  "objectKey",
  "thumbnailObjectKey",
  "storageObjectKey",
  "payload",
  "beforeData",
  "afterData",
  "ipAddress",
  "userAgent",
  "sessionId",
  "journalEntry",
  "ledgerEntry",
] as const;

/**
 * Never on an audit response.
 *
 * `beforeData`/`afterData` are arbitrary JSON copies of rows and carry
 * whatever the row carried. `ipAddress`/`userAgent` are request metadata
 * about a person, kept for forensics rather than for browsing.
 */
export const AUDIT_LOG_FORBIDDEN_FIELDS = [
  "beforeData",
  "afterData",
  "ipAddress",
  "userAgent",
] as const;

/**
 * Never on an outbox response.
 *
 * A payload carries the address a message was sent to; `lastError` would
 * carry provider exception text, which routinely echoes the same
 * address.
 */
export const OUTBOX_FORBIDDEN_FIELDS = [
  "payload",
  "lastError",
  "lockedBy",
  "idempotencyKey",
  "email",
  "subject",
  "recipient",
] as const;

/**
 * Never on a settings response.
 *
 * The registry shape is already closed — `{key, type, description,
 * adminWritable, allowedValues, value}` — but a setting's VALUE is
 * arbitrary JSON, so a secret stored as a setting would travel in it.
 * Asserted rather than assumed.
 */
export const SETTINGS_FORBIDDEN_FIELDS = [
  "secret",
  "apiKey",
  "privateKey",
  "webhookSecret",
  "encryptionKey",
] as const;
