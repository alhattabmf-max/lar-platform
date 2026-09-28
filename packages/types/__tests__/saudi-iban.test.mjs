import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSaudiIban,
  isValidSaudiIban,
  saudiBankCodeOf,
  saudiBankFromIban,
  formatSaudiIban,
  SAUDI_BANKS,
  SAUDI_IBAN_LENGTH,
} from "../dist/index.js";

/**
 * THE IBAN RULE, PINNED.
 *
 * Two things are checked here and they fail for different reasons:
 *
 *   · MOD-97 — arithmetic, and it either implements ISO 7064 or it
 *     does not. A regression here accepts a mistyped account number
 *     and a supplier is paid into the wrong place.
 *
 *   · THE BANK TABLE — reference data about the world. A regression
 *     here shows the wrong bank's name above a real IBAN. The nine
 *     codes named below were each confirmed against a published
 *     example IBAN from a source independent of the table itself, and
 *     they are written out one by one rather than looped so that a
 *     wrong entry reads as itself.
 */

/**
 * PUBLISHED EXAMPLE IBANs, each one the bank's own published sample.
 * They are real-shaped and check-digit-valid, which is what makes them
 * usable as fixtures — and they belong to nobody, which is what makes
 * it safe to commit them.
 */
const PUBLISHED = [
  ["SA6805000084000066666000", "05", "مصرف الإنماء"],
  ["SA8715000452133742070015", "15", "بنك البلاد"],
  ["SA5655000000083793500149", "55", "البنك السعودي الفرنسي"],
  ["SA0530400108061804740012", "30", "البنك العربي الوطني"],
];

describe("MOD-97", () => {
  test("accepts every published example", () => {
    for (const [iban] of PUBLISHED) {
      assert.equal(isValidSaudiIban(iban), true, iban);
    }
  });

  test("rejects a single transposed digit in each of them", () => {
    // The whole point of a check digit: one slip and it fails. The
    // pair swapped is the first ADJACENT UNEQUAL one, because swapping
    // two equal digits changes nothing and would prove nothing.
    for (const [iban] of PUBLISHED) {
      let swappedAt = -1;
      for (let i = 4; i < iban.length - 1; i += 1) {
        if (iban[i] !== iban[i + 1]) {
          swappedAt = i;
          break;
        }
      }
      assert.notEqual(swappedAt, -1, `${iban} has no unequal adjacent pair`);
      const swapped =
        iban.slice(0, swappedAt) +
        iban[swappedAt + 1] +
        iban[swappedAt] +
        iban.slice(swappedAt + 2);
      assert.equal(isValidSaudiIban(swapped), false, swapped);
    }
  });

  test("rejects the wrong length, the wrong country and letters inside", () => {
    assert.equal(isValidSaudiIban("SA680500008400006666600"), false, "23 chars");
    assert.equal(
      isValidSaudiIban("SA68050000840000666660000"),
      false,
      "25 chars",
    );
    assert.equal(isValidSaudiIban("AE680500008400006666600A"), false, "not SA");
    assert.equal(
      isValidSaudiIban("SA680500008400006666600A"),
      false,
      "letter in the account number",
    );
    assert.equal(isValidSaudiIban(""), false, "empty");
  });

  test("does not lose precision on 24 characters", () => {
    // A 24-digit value is far past Number.MAX_SAFE_INTEGER. An
    // implementation that built one number would start accepting
    // numbers whose remainder is not 1.
    assert.ok(SAUDI_IBAN_LENGTH === 24);
    assert.equal(isValidSaudiIban("SA0000000000000000000000"), false);
    assert.equal(isValidSaudiIban("SA9999999999999999999999"), false);
  });

  test("is applied to the normalized form, not the typed one", () => {
    const spaced = "SA68 0500 0084 0000 6666 6000";
    assert.equal(isValidSaudiIban(spaced), false, "spaces are not stripped for it");
    assert.equal(isValidSaudiIban(normalizeSaudiIban(spaced)), true);
    assert.equal(normalizeSaudiIban(" sa68 0500 0084 0000 6666 6000 "),
      "SA6805000084000066666000");
  });
});

describe("the bank the number names", () => {
  test("each published example resolves to its own bank", () => {
    for (const [iban, code, nameAr] of PUBLISHED) {
      assert.equal(saudiBankCodeOf(iban), code, iban);
      assert.equal(saudiBankFromIban(iban)?.nameAr, nameAr, iban);
    }
  });

  /**
   * The nine confirmed codes, named individually. Anything that
   * reshuffles this table breaks exactly the line that is wrong.
   */
  test("05 is Alinma", () => assert.equal(SAUDI_BANKS["05"].nameAr, "مصرف الإنماء"));
  test("10 is the Saudi National Bank", () =>
    assert.equal(SAUDI_BANKS["10"].nameAr, "البنك الأهلي السعودي"));
  test("15 is AlBilad", () => assert.equal(SAUDI_BANKS["15"].nameAr, "بنك البلاد"));
  test("20 is Riyad Bank", () => assert.equal(SAUDI_BANKS["20"].nameAr, "بنك الرياض"));
  test("30 is the Arab National Bank", () =>
    assert.equal(SAUDI_BANKS["30"].nameAr, "البنك العربي الوطني"));
  test("45 is SABB", () =>
    assert.equal(SAUDI_BANKS["45"].nameAr, "البنك السعودي البريطاني"));
  test("55 is Banque Saudi Fransi", () =>
    assert.equal(SAUDI_BANKS["55"].nameAr, "البنك السعودي الفرنسي"));
  test("60 is AlJazira", () => assert.equal(SAUDI_BANKS["60"].nameAr, "بنك الجزيرة"));
  test("80 is Al Rajhi", () => assert.equal(SAUDI_BANKS["80"].nameAr, "مصرف الراجحي"));

  test("80 is NOT the Saudi National Bank", () => {
    // The design mock-up this feature came from showed an IBAN
    // beginning SA03 80… captioned «البنك الأهلي السعودي». It is
    // placeholder text: 80 is Al Rajhi. Pinned so nobody re-derives
    // the table from the picture.
    assert.notEqual(SAUDI_BANKS["80"].nameAr, SAUDI_BANKS["10"].nameAr);
  });

  test("a merged bank still resolves, and says where it went", () => {
    // Old IBANs keep their code and keep working.
    assert.equal(SAUDI_BANKS["40"].mergedIntoAr, "البنك الأهلي السعودي");
    assert.equal(SAUDI_BANKS["50"].mergedIntoAr, "البنك السعودي البريطاني");
  });

  test("every entry's key matches its own code, and both names are set", () => {
    for (const [key, bank] of Object.entries(SAUDI_BANKS)) {
      assert.equal(bank.code, key, `key ${key}`);
      assert.match(key, /^\d{2}$/, `key ${key} is two digits`);
      assert.ok(bank.nameAr.length > 0, `${key} has an Arabic name`);
      assert.ok(bank.nameEn.length > 0, `${key} has an English name`);
    }
  });

  test("no two codes share a name", () => {
    // Two codes resolving to one name would mean a merged bank was
    // recorded as the survivor rather than as itself, and a supplier
    // would not recognise their own account.
    const names = Object.values(SAUDI_BANKS).map((b) => b.nameAr);
    assert.equal(new Set(names).size, names.length);
  });
});

describe("an unknown code is not an error", () => {
  test("returns null rather than guessing", () => {
    // 99 is not assigned in the table. The IBAN below is checksum-valid.
    const iban = "SA5499000000000000000000";
    assert.equal(isValidSaudiIban(iban), true, "the fixture must be valid");
    assert.equal(saudiBankCodeOf(iban), "99");
    assert.equal(saudiBankFromIban(iban), null);
  });

  test("a malformed number resolves to null too", () => {
    assert.equal(saudiBankFromIban("not an iban"), null);
    assert.equal(saudiBankFromIban(""), null);
  });
});

describe("reading it back", () => {
  test("groups in fours with no trailing space", () => {
    assert.equal(
      formatSaudiIban("SA6805000084000066666000"),
      "SA68 0500 0084 0000 6666 6000",
    );
  });
});
