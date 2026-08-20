import { authenticator } from "otplib";

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
}

/** Generates a fresh TOTP secret and its otpauth:// URI for enrollment. */
export function generateTotpEnrollment(accountEmail: string, issuer: string): TotpEnrollment {
  const secret = authenticator.generateSecret();
  const otpauthUri = authenticator.keyuri(accountEmail, issuer, secret);
  return { secret, otpauthUri };
}

/** Verifies a 6-digit TOTP code against the (decrypted) secret. */
export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}
