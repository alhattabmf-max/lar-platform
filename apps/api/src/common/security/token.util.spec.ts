import { generateToken, hashToken } from "./token.util";

describe("token utilities", () => {
  it("generates a high-entropy hex token", () => {
    const token = generateToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates a different token on every call", () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it("hashes deterministically — the same token always hashes the same way", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("never stores the raw token as its own hash", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toBe(token);
  });
});
