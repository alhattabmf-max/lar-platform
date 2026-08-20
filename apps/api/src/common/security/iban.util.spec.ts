import {
  normalizeIban,
  isValidSaudiIban,
  fingerprintIban,
  lastFourOf,
} from "./iban.util";

const KEY = "a".repeat(64);
const VALID_IBAN = "SA0380000000608010167519";

describe("IBAN utilities", () => {
  describe("normalizeIban", () => {
    it("uppercases and strips whitespace", () => {
      expect(normalizeIban(" sa03 8000 0000 6080 1016 7519 ")).toBe(VALID_IBAN);
    });
  });

  describe("isValidSaudiIban", () => {
    it("accepts a well-formed Saudi IBAN with a valid ISO 13616 checksum", () => {
      expect(isValidSaudiIban(VALID_IBAN)).toBe(true);
    });

    it("rejects a correctly shaped Saudi IBAN with an invalid checksum", () => {
      expect(isValidSaudiIban("SA0380000000608010167518")).toBe(false);
    });

    it("rejects a non-Saudi country code", () => {
      expect(isValidSaudiIban("GB33BUKB20201555555555")).toBe(false);
    });

    it("rejects the wrong length", () => {
      expect(isValidSaudiIban("SA038000000060801016751")).toBe(false); // one digit short
    });

    it("rejects non-digit characters after the country code", () => {
      expect(isValidSaudiIban("SA03800000006080101675XX")).toBe(false);
    });
  });

  describe("fingerprintIban", () => {
    it("is deterministic for the same IBAN and key", () => {
      expect(fingerprintIban(VALID_IBAN, KEY)).toBe(
        fingerprintIban(VALID_IBAN, KEY),
      );
    });

    it("differs for different IBANs under the same key", () => {
      const other = "SA0380000000608010167520";
      expect(fingerprintIban(VALID_IBAN, KEY)).not.toBe(
        fingerprintIban(other, KEY),
      );
    });

    it("differs for the same IBAN under different keys (domain separation holds per-key)", () => {
      const otherKey = "b".repeat(64);
      expect(fingerprintIban(VALID_IBAN, KEY)).not.toBe(
        fingerprintIban(VALID_IBAN, otherKey),
      );
    });

    it("is a 64-character hex string (SHA-256 output)", () => {
      expect(fingerprintIban(VALID_IBAN, KEY)).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("lastFourOf", () => {
    it("returns exactly the last 4 characters", () => {
      expect(lastFourOf(VALID_IBAN)).toBe("7519");
    });
  });
});
