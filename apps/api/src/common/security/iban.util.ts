import { createHash, createHmac } from "crypto";
import {
  normalizeSaudiIban,
  isValidSaudiIban as isWellFormedSaudiIban,
  saudiBankFromIban,
} from "@platform/types";

/**
 * IBAN handling, split in two on purpose.
 *
 * THE FORMAT RULES LIVE IN `@platform/types`, because the form has to
 * apply exactly the same ones as the server: a supplier should see the
 * bank appear beside the field as they type, and see the same answer
 * the server will give. There is one MOD-97 in this repository and it
 * is there.
 *
 * THE SECRETS LIVE HERE, because they need the encryption key and Node
 * crypto, and neither belongs in a package the browser imports.
 */

/** Uppercase, strip whitespace — the canonical form stored/compared everywhere. */
export const normalizeIban = normalizeSaudiIban;

/**
 * Well-formed Saudi IBAN: "SA" + 22 digits, checksum agreeing.
 *
 * A TYPO-CATCHER, NOT A VERIFICATION. It says nothing about whether the
 * account exists or who owns it; the company's approval review is what
 * answers that.
 */
export const isValidSaudiIban = isWellFormedSaudiIban;

/** The bank the number itself names, or null when the code is unknown. */
export const bankFromIban = saudiBankFromIban;

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
