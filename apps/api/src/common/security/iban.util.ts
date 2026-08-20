import { createHash, createHmac } from "crypto";

/** Uppercase, strip whitespace — the canonical form stored/compared everywhere. */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/**
 * Saudi IBAN format: "SA" + 22 digits = 24 characters total. The
 * platform operates in Saudi Arabia (Blueprint-wide assumption), so
 * this is the one format validated here rather than the fully general
 * (and much looser) international IBAN pattern.
 */
const SAUDI_IBAN_PATTERN = /^SA\d{22}$/;

export function isValidSaudiIban(normalized: string): boolean {
  if (!SAUDI_IBAN_PATTERN.test(normalized)) return false;

  // ISO 13616 checksum without converting the complete value to a JS number.
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const numeric = /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * A domain-separated key derived from the raw encryption key,
 * specifically for fingerprinting — never the same key material used
 * directly for AES-GCM encryption or for any other purpose.
 */
function deriveFingerprintKey(encryptionKeyHex: string): Buffer {
  return createHash("sha256")
    .update(Buffer.from(encryptionKeyHex, "hex"))
    .update("iban-fingerprint-v1")
    .digest();
}

/**
 * HMAC-SHA256 fingerprint of a normalized IBAN — lets the platform
 * detect "is this the same account as before" (e.g. a resubmission,
 * or the same account appearing under a different company as a risk
 * signal) WITHOUT ever decrypting stored ciphertext to compare. Not
 * globally unique-constrained by design (see docs) — a collision
 * across companies is a signal to review, not a hard rejection.
 */
export function fingerprintIban(
  normalized: string,
  encryptionKeyHex: string,
): string {
  const key = deriveFingerprintKey(encryptionKeyHex);
  return createHmac("sha256", key).update(normalized).digest("hex");
}

export function lastFourOf(normalized: string): string {
  return normalized.slice(-4);
}
