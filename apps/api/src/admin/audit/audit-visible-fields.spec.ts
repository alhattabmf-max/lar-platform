import {
  AUDIT_VALUE_MAX_LENGTH,
  AUDIT_VISIBLE_FIELDS,
  AUDIT_VISIBLE_FIELD_NAMES,
  auditVisibleData,
} from "@platform/types";

/**
 * The audit trail's before/after view.
 *
 * THE POINT OF THIS FILE IS WHAT DOES NOT COME OUT. `before_data` and
 * `after_data` are arbitrary JSON copies of rows, and the projection is
 * the only thing between them and a screen. Most of what follows is
 * therefore a refusal, and the refusals are written against the real
 * key names present in this platform's own audit table rather than
 * against imagined ones.
 */

describe("nothing sensitive can reach the screen", () => {
  /**
   * Read off `audit_logs` in the development database: every key that
   * actually appears in a stored payload and must never be shown.
   * Written out rather than derived so that adding one of them to the
   * allow-list is a test failure, not a silent widening.
   */
  const MUST_NEVER_SHOW = [
    // Banking, masked or not.
    "ibanLast4",
    "bankName",
    // People and businesses.
    "email",
    "ownerEmail",
    "phone",
    "primaryMobile2",
    "contactName",
    "contactPhone",
    "shortAddress",
    "crNumber",
    "legalName",
    "invoicingLegalName",
    "companyName",
    // Names of any kind: one list cannot tell a category rename from a
    // company's legal name by the key alone.
    "name",
    "nameAr",
    "nameEn",
    // A settings payload, which can hold security configuration.
    "value",
  ];

  it.each(MUST_NEVER_SHOW)("never shows `%s`", (field) => {
    expect(AUDIT_VISIBLE_FIELD_NAMES).not.toContain(field);
    expect(auditVisibleData({ [field]: "something" })).toBeNull();
  });

  /**
   * Not a list of real keys — a list of what a secret is called
   * wherever it appears. If one of these ever matches an allow-listed
   * name, something went badly wrong in review.
   */
  it.each([
    "password",
    "passwordHash",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "totpSecret",
    "recoveryCode",
    "recoveryCodeHash",
    "sessionId",
    "ticket",
    "apiKey",
    "iban",
    "ibanCiphertext",
    "ibanFingerprint",
    "cardNumber",
    "objectKey",
    "storageKey",
  ])("never shows `%s`", (field) => {
    expect(AUDIT_VISIBLE_FIELD_NAMES).not.toContain(field);
    expect(auditVisibleData({ [field]: "x" })).toBeNull();
  });

  it("has no allow-listed name that reads like a secret", () => {
    // A second layer, catching a name added later that nobody checked
    // against the list above.
    const suspicious =
      /pass|secret|token|ticket|session|hash|key|iban|card|cvv|otp|totp|recovery|credential|auth/i;
    const offenders = AUDIT_VISIBLE_FIELD_NAMES.filter((name) =>
      suspicious.test(name),
    );
    expect(offenders).toEqual([]);
  });

  it("shows nothing at all from a payload of only unapproved fields", () => {
    expect(
      auditVisibleData({
        email: "someone@example.com",
        ibanLast4: "4321",
        crNumber: "1010101010",
        passwordHash: "$2b$12$abcdef",
      }),
    ).toBeNull();
  });

  /**
   * THE CASE THE SCALAR RULE EXISTS FOR: a whole row travelling inside
   * a field that is on the list.
   */
  it("refuses an object hiding under an approved name", () => {
    expect(
      auditVisibleData({
        status: { email: "someone@example.com", ibanLast4: "4321" },
      }),
    ).toBeNull();
  });

  it("refuses an array hiding under an approved name", () => {
    expect(auditVisibleData({ status: ["ACTIVE", "someone@example.com"] })).toBeNull();
  });

  it("refuses a value longer than the bound rather than truncating it", () => {
    // Half a value in an audit trail reads as the value.
    const long = "x".repeat(AUDIT_VALUE_MAX_LENGTH + 1);
    expect(auditVisibleData({ status: long })).toBeNull();
    expect(auditVisibleData({ status: "x".repeat(AUDIT_VALUE_MAX_LENGTH) })).toEqual({
      status: "x".repeat(AUDIT_VALUE_MAX_LENGTH),
    });
  });

  it("does not walk the payload's own keys", () => {
    // Driven by the list, so an unapproved key beside an approved one
    // changes nothing about the output.
    expect(
      auditVisibleData({ isActive: true, ibanLast4: "4321", email: "a@b.co" }),
    ).toEqual({ isActive: true });
  });

  it("ignores an inherited property", () => {
    // `hasOwnProperty`, not `in`: a prototype-borne `status` is not a
    // value this row carried.
    const payload = Object.create({ status: "ACTIVE" }) as Record<string, unknown>;
    payload.isActive = true;
    expect(auditVisibleData(payload)).toEqual({ isActive: true });
  });
});

describe("what it does show", () => {
  it("shows a status change, which is the whole point", () => {
    expect(auditVisibleData({ status: "SUSPENDED" })).toEqual({
      status: "SUSPENDED",
    });
  });

  it.each([
    ["a boolean", { isActive: false }],
    ["a number", { sortOrder: 3 }],
    ["a null", { parentId: null }],
    ["a rate", { ratePercent: 15 }],
    ["a fee", { sameCityFeeAmount: 25 }],
    ["a window", { startsAt: "2026-01-01T00:00:00.000Z" }],
  ])("shows %s", (_label, payload) => {
    expect(auditVisibleData(payload)).toEqual(payload);
  });

  it("covers the five approved reasons and nothing else", () => {
    expect(Object.keys(AUDIT_VISIBLE_FIELDS).sort()).toEqual([
      "activation",
      "commercial",
      "placement",
      "status",
    ]);
  });

  it("names no field twice across the groups", () => {
    expect(new Set(AUDIT_VISIBLE_FIELD_NAMES).size).toBe(
      AUDIT_VISIBLE_FIELD_NAMES.length,
    );
  });
});

describe("a payload that is not an object", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["a string", "ACTIVE"],
    ["a number", 7],
  ])("reads %s as no detail rather than throwing", (_label, payload) => {
    expect(auditVisibleData(payload)).toBeNull();
  });
});
