import { normaliseEmail, sameEmailIdentity } from "./email.util";

/**
 * ONE SPELLING OF AN ADDRESS.
 *
 * THE DEFECT THIS CLOSES, reproduced against the development database
 * before it was fixed: `dup-case@forsa.test`, `DUP-CASE@Forsa.TEST` and
 * `Dup-Case@forsa.test` all registered successfully — two buyers and a
 * supplier on one address — because `users.email` is unique on the RAW
 * column and nothing normalised what went into it.
 */
describe("normalising an address", () => {
  it("strips the spaces a paste leaves behind", () => {
    expect(normaliseEmail("  owner@example.com  ")).toBe("owner@example.com");
    expect(normaliseEmail("\towner@example.com\n")).toBe("owner@example.com");
  });

  it("folds the case of the whole address", () => {
    // The local part is case-sensitive by RFC 5321 and no provider a
    // Saudi company uses treats it that way. The alternative is
    // accepting two accounts on one mailbox, which is the defect.
    expect(normaliseEmail("Owner@Example.COM")).toBe("owner@example.com");
    expect(normaliseEmail("OWNER@EXAMPLE.COM")).toBe("owner@example.com");
  });

  it("collapses the three spellings that became three accounts", () => {
    const spellings = [
      "dup-case@forsa.test",
      "DUP-CASE@Forsa.TEST",
      " Dup-Case@forsa.test ",
    ];
    const normalised = new Set(spellings.map(normaliseEmail));

    expect([...normalised]).toEqual(["dup-case@forsa.test"]);
  });

  it("leaves an address that is already normal exactly as it is", () => {
    expect(normaliseEmail("owner@example.com")).toBe("owner@example.com");
  });

  it("does NOT validate — that judgement belongs to @IsEmail()", () => {
    // A value that is not an address comes back unchanged rather than
    // being silently repaired into something that passes.
    expect(normaliseEmail("not an address")).toBe("not an address");
    expect(normaliseEmail("")).toBe("");
  });

  it("does not touch the parts of an address that carry meaning", () => {
    // Plus-addressing and dots are how people route their own mail; a
    // normaliser that stripped them would merge two mailboxes that
    // really are different.
    expect(normaliseEmail("Owner+forsa@example.com")).toBe(
      "owner+forsa@example.com",
    );
    expect(normaliseEmail("first.last@example.com")).toBe(
      "first.last@example.com",
    );
  });
});

describe("comparing two addresses as identities", () => {
  it("treats the spellings of one mailbox as one identity", () => {
    expect(sameEmailIdentity("Owner@X.com", " owner@x.com ")).toBe(true);
  });

  it("keeps genuinely different addresses apart", () => {
    expect(sameEmailIdentity("owner@x.com", "owner@y.com")).toBe(false);
    expect(sameEmailIdentity("owner+a@x.com", "owner+b@x.com")).toBe(false);
  });
});
