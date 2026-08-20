import {
  encryptEnvelope,
  decryptEnvelope,
  type KeyRing,
} from "./crypto-envelope.util";

const keyRing: KeyRing = {
  v1: "a".repeat(64),
  v2: "b".repeat(64),
};

describe("crypto envelope", () => {
  it("round-trips plaintext through encrypt/decrypt", () => {
    const envelope = encryptEnvelope("SA0380000000608010167519", keyRing, "v1");
    expect(decryptEnvelope(envelope, keyRing)).toBe("SA0380000000608010167519");
  });

  it("embeds the key version in the envelope so old ciphertexts keep decrypting after rotation", () => {
    const envelope = encryptEnvelope("secret-data", keyRing, "v1");
    // Simulate rotation: v2 is now the active version, but v1 stays in the ring.
    expect(decryptEnvelope(envelope, keyRing)).toBe("secret-data");

    const newEnvelope = encryptEnvelope("secret-data", keyRing, "v2");
    expect(newEnvelope.startsWith("v2:")).toBe(true);
    expect(decryptEnvelope(newEnvelope, keyRing)).toBe("secret-data");
  });

  it("produces a different ciphertext each time (random IV) even for the same plaintext", () => {
    const a = encryptEnvelope("same-value", keyRing, "v1");
    const b = encryptEnvelope("same-value", keyRing, "v1");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with an unknown key version", () => {
    const envelope = encryptEnvelope("secret-data", keyRing, "v1").replace(
      /^v1:/,
      "v99:",
    );
    expect(() => decryptEnvelope(envelope, keyRing)).toThrow(
      /No decryption key configured/,
    );
  });

  it("fails to decrypt tampered ciphertext (auth tag mismatch)", () => {
    const envelope = encryptEnvelope("secret-data", keyRing, "v1");
    const [version, iv, authTag, ciphertext] = envelope.split(":");
    const tampered = `${version}:${iv}:${authTag}:${ciphertext.slice(0, -2)}00`;
    expect(() => decryptEnvelope(tampered, keyRing)).toThrow();
  });

  it("throws on a malformed envelope", () => {
    expect(() => decryptEnvelope("not-a-valid-envelope", keyRing)).toThrow(
      /Malformed/,
    );
  });

  it("rejects encryption keys that are not exactly 32 bytes of hex", () => {
    expect(() => encryptEnvelope("secret", { v1: "abcd" }, "v1")).toThrow(
      /32 bytes/,
    );
  });
});
