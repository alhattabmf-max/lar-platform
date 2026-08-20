import { createHash, randomBytes } from "crypto";

/** Generates a high-entropy opaque token (256 bits). */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Only this hash is ever stored in the database — never the raw
 * token. SHA-256 is appropriate here (unlike password hashing)
 * because the input is already a high-entropy random value, not a
 * human-chosen secret vulnerable to dictionary/brute-force attacks.
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
