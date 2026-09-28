import { BankDataCryptoService } from "./bank-data-crypto.service";
import type { Env } from "@platform/config";

function fakeEnv(bankKey: string, adminKey: string): Env {
  return {
    ADMIN_TOTP_ENCRYPTION_KEY: adminKey,
    ADMIN_TOTP_ISSUER: "Azier Plus Admin",
    BANK_DATA_ENCRYPTION_KEY: bankKey,
  } as Env;
}

describe("BankDataCryptoService", () => {
  it("encrypts and decrypts an IBAN correctly", () => {
    const service = new BankDataCryptoService(fakeEnv("a".repeat(64), "b".repeat(64)));
    const encrypted = service.encrypt("SA0380000000608010167519");
    expect(encrypted).not.toContain("SA03");
    expect(service.decrypt(encrypted)).toBe("SA0380000000608010167519");
  });

  it("uses BANK_DATA_ENCRYPTION_KEY, not ADMIN_TOTP_ENCRYPTION_KEY — ciphertext differs when only the bank key changes", () => {
    const adminKey = "b".repeat(64);
    const serviceA = new BankDataCryptoService(fakeEnv("a".repeat(64), adminKey));
    const serviceB = new BankDataCryptoService(fakeEnv("c".repeat(64), adminKey));

    // Same admin key, different bank key -> must produce independently
    // decryptable ciphertext, proving the two keys are not conflated.
    const encryptedA = serviceA.encrypt("same-iban-value");
    expect(() => serviceB.decrypt(encryptedA)).toThrow();
  });

  it("the encrypted payload never contains the raw plaintext as a substring", () => {
    const service = new BankDataCryptoService(fakeEnv("a".repeat(64), "b".repeat(64)));
    const iban = "SA0380000000608010167519";
    const encrypted = service.encrypt(iban);
    expect(encrypted).not.toContain(iban);
  });
});
