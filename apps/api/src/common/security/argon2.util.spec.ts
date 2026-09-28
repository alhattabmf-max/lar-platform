import { hashPassword, verifyPassword } from "./argon2.util";

/**
 * A longer budget than the 5-second default, because the thing under
 * test is deliberately slow.
 *
 * Argon2id is memory-hard on purpose: that cost is the whole defence
 * against an offline attack on a stolen hash. Alone, each call here
 * takes about 150ms; run as one of a hundred and ten suites competing
 * for the same cores, two of these crossed five seconds and failed on
 * the clock rather than on anything they were asserting.
 *
 * The budget is raised rather than the parameters lowered — weakening
 * the hash to make a test finish sooner would trade a real defence for
 * a green tick.
 */
jest.setTimeout(30_000);

describe("argon2 utilities", () => {
  it("hashes a password into an argon2id-formatted hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("returns false instead of throwing for a malformed hash", async () => {
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
  });
});
