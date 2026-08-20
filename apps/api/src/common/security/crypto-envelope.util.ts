import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export type KeyRing = Record<string, string>; // version -> 64-hex-char (32-byte) key

/**
 * Envelope format: `${keyVersion}:${ivHex}:${authTagHex}:${ciphertextHex}`.
 * The version is stored WITH the ciphertext (not inferred from config),
 * so a future key rotation is: add the new version to the KeyRing,
 * start encrypting with it, and old rows keep decrypting correctly
 * using the version embedded in their own payload — no migration of
 * existing rows required, no schema change.
 */
export function encryptEnvelope(
  plaintext: string,
  keyRing: KeyRing,
  activeVersion: string,
): string {
  const keyHex = keyRing[activeVersion];
  if (!keyHex) {
    throw new Error(
      `No encryption key configured for version "${activeVersion}"`,
    );
  }

  const key = decodeKey(keyHex, activeVersion);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${activeVersion}:${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptEnvelope(payload: string, keyRing: KeyRing): string {
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed encrypted envelope");
  }
  const [version, ivHex, authTagHex, ciphertextHex] = parts;
  if (
    !version ||
    !isHex(ivHex, IV_LENGTH * 2) ||
    !isHex(authTagHex, 32) ||
    !isHex(ciphertextHex)
  ) {
    throw new Error("Malformed encrypted envelope");
  }

  const keyHex = keyRing[version];
  if (!keyHex) {
    throw new Error(
      `No decryption key configured for envelope version "${version}"`,
    );
  }

  const key = decodeKey(keyHex, version);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf-8");
}

function isHex(value: string, exactLength?: number): boolean {
  if (exactLength !== undefined && value.length !== exactLength) return false;
  return (
    value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)
  );
}

function decodeKey(keyHex: string, version: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error(
      `Encryption key for version "${version}" must be exactly 32 bytes encoded as hex`,
    );
  }
  return Buffer.from(keyHex, "hex");
}
