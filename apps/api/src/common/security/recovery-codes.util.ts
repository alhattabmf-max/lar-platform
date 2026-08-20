import { randomInt } from "crypto";
import { hashToken } from "./token.util";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I/L)

function randomCode(): string {
  let code = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export interface GeneratedRecoveryCodes {
  /** Raw codes — return to the caller once, never persist. */
  plaintext: string[];
  /** Hashes — the only form ever written to the database. */
  hashes: string[];
}

export function generateRecoveryCodes(): GeneratedRecoveryCodes {
  const plaintext = Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
  return { plaintext, hashes: plaintext.map(hashToken) };
}
