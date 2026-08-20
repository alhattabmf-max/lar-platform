import * as argon2 from "argon2";

/**
 * Argon2id exclusively (Blueprint §6 Security Baseline) — never
 * bcrypt/md5/sha for passwords. This is the single place password
 * hashing happens; nothing else in the codebase should call `argon2`
 * directly.
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plainPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainPassword);
  } catch {
    // A malformed/foreign hash format throws rather than returning
    // false — treat that the same as "did not match".
    return false;
  }
}
