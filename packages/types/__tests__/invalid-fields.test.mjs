import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  readInvalidFields,
  NAMEABLE_INVALID_FIELDS,
} from "../dist/index.js";

/**
 * WHICH FIELDS A REFUSAL NAMED — and the rule that keeps it safe.
 *
 * THE COMPLAINT THIS ANSWERS: a refused save showed a sentence and a
 * reference number, leaving the person who typed the form to hunt for
 * which of a dozen fields was wrong. The server DID say, in
 * `details.validationErrors`; the portal threw it away, because those
 * strings are English developer text that can carry internal property
 * paths and NOTHING from a failure may be rendered.
 *
 * THAT RULE IS NOT WAIVED, and these are what prove it: only a name
 * that MATCHES the closed list survives, and the caller renders its own
 * label for it. Anything unrecognised yields nothing.
 */

const envelope = (validationErrors, code = "VALIDATION_FAILED") => ({
  error: { code, details: { validationErrors } },
});

describe("what it reads", () => {
  test("names the field class-validator put first", () => {
    assert.deepEqual(
      readInvalidFields(
        envelope([
          "accountHolderName must be longer than or equal to 1 characters",
        ]),
      ),
      ["accountHolderName"],
    );
  });

  test("names several, in the order they arrived", () => {
    assert.deepEqual(
      readInvalidFields(
        envelope([
          "email must be an email",
          "vatNumber must be a string",
          "iban should not be empty",
        ]),
      ),
      ["email", "vatNumber", "iban"],
    );
  });

  test("says each one once", () => {
    assert.deepEqual(
      readInvalidFields(
        envelope(["iban should not be empty", "iban must be a string"]),
      ),
      ["iban"],
    );
  });
});

describe("what it refuses to read — the rule itself", () => {
  test("a field this build does not know yields nothing", () => {
    // The generic message stands, exactly as before this existed.
    assert.deepEqual(
      readInvalidFields(envelope(["internalLedgerRef must be a UUID"])),
      [],
    );
  });

  test("a nested property path yields nothing", () => {
    // `items.0.priceMinor` is an internal shape, not a form field.
    assert.deepEqual(
      readInvalidFields(envelope(["items.0.priceMinor must be an integer"])),
      [],
    );
  });

  test("another error code yields nothing", () => {
    assert.deepEqual(
      readInvalidFields(envelope(["email must be an email"], "CONFLICT")),
      [],
    );
  });

  test("a payload of another shape yields nothing", () => {
    assert.deepEqual(readInvalidFields(null), []);
    assert.deepEqual(readInvalidFields("nope"), []);
    assert.deepEqual(readInvalidFields({}), []);
    assert.deepEqual(readInvalidFields({ error: {} }), []);
    assert.deepEqual(readInvalidFields({ error: { code: "VALIDATION_FAILED" } }), []);
    assert.deepEqual(
      readInvalidFields({
        error: { code: "VALIDATION_FAILED", details: { validationErrors: "x" } },
      }),
      [],
    );
  });

  test("a non-string entry among strings is skipped, not thrown on", () => {
    assert.deepEqual(
      readInvalidFields(
        envelope([{ field: "iban" }, "email must be an email", 42]),
      ),
      ["email"],
    );
  });

  test("it returns NAMES only — never the server's sentence", () => {
    const out = readInvalidFields(
      envelope(["email must be an email address, e.g. a@b.co"]),
    );
    assert.deepEqual(out, ["email"]);
    assert.equal(
      out.some((f) => f.includes(" ")),
      false,
    );
  });
});

describe("the closed list", () => {
  test("holds only form fields, never a database column nobody types", () => {
    for (const field of NAMEABLE_INVALID_FIELDS) {
      assert.match(field, /^[a-zA-Z][a-zA-Z0-9]*$/, field);
      assert.equal(field.includes("."), false, field);
    }
  });

  test("has no duplicates", () => {
    assert.equal(
      new Set(NAMEABLE_INVALID_FIELDS).size,
      NAMEABLE_INVALID_FIELDS.length,
    );
  });

  test("covers the fields «بيانات المنشأة» actually submits", () => {
    for (const field of [
      "email",
      "accountHolderName",
      "iban",
      "vatNumber",
      "shortAddress",
      "regionId",
      "contactPhone",
    ]) {
      assert.ok(NAMEABLE_INVALID_FIELDS.includes(field), field);
    }
  });
});
