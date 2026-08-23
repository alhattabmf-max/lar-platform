import {
  HEADER_NAV_MAX_ITEMS,
  HEADER_NAV_SETTING_KEY,
  SITE_CONTENT_FIELDS,
  SITE_CONTENT_LIMITS,
  SITE_CONTENT_SETTING_KEY,
} from "@platform/types";
import { SETTINGS_REGISTRY, getSettingDefinition } from "./settings-registry";
import { SETTINGS_KEYS } from "../../settings/settings-keys.constants";
import { SETTINGS_FORBIDDEN_FIELDS } from "../../common/contracts/admin-forbidden-fields";

/**
 * The two settings that hold operator-written site content.
 *
 * They are the only settings on this platform whose value is written by
 * a person and rendered to the public, which is why their validators
 * carry the weight they do:
 *
 *   - Homepage copy is TEXT. There is no markup path anywhere that
 *     renders it, and the validator refuses anything that is not a
 *     string pair, so a stored object cannot become one.
 *   - Header navigation is TAXONOMY IDS. Never URLs. An operator cannot
 *     type a destination, so there is nothing to allowlist and no way
 *     to point the site's navigation off-site.
 *
 * Both fall back to the shipped message catalogue when missing or
 * malformed, so a bad edit degrades to the built-in copy rather than to
 * an empty page.
 */

const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

describe("the two content keys are the ones the portal writes to", () => {
  it("the API registers exactly the shared literals", () => {
    // A second copy of these strings is how the portal ends up writing
    // to a key nothing reads: the write succeeds, the screen reports
    // success, and the site never changes.
    expect(SETTINGS_KEYS.HOMEPAGE_CONTENT).toBe(SITE_CONTENT_SETTING_KEY);
    expect(SETTINGS_KEYS.HEADER_NAV).toBe(HEADER_NAV_SETTING_KEY);
    expect(getSettingDefinition(SITE_CONTENT_SETTING_KEY)).toBeDefined();
    expect(getSettingDefinition(HEADER_NAV_SETTING_KEY)).toBeDefined();
  });

  it("both are admin-writable and typed as json", () => {
    for (const key of [SITE_CONTENT_SETTING_KEY, HEADER_NAV_SETTING_KEY]) {
      const definition = SETTINGS_REGISTRY[key];
      expect(definition.adminWritable).toBe(true);
      expect(definition.type).toBe("json");
      // A malformed value must never take the homepage down.
      expect(definition.failSafeBehavior).toBe("safe-default-on-failure");
    }
  });
});

describe("homepage content accepts only bilingual text", () => {
  const validate = SETTINGS_REGISTRY[SITE_CONTENT_SETTING_KEY].validate;

  const text = (value: string) => ({ ar: value, en: value });

  it("accepts an empty object — every field is optional", () => {
    expect(validate({})).toBe(true);
  });

  it("accepts every declared field", () => {
    const full: Record<string, unknown> = {};
    for (const field of SITE_CONTENT_FIELDS) full[field] = text("مرحبًا");
    expect(validate(full)).toBe(true);
  });

  it("accepts null for either language — null means use the default", () => {
    expect(validate({ heroTitle: { ar: null, en: "Hello" } })).toBe(true);
    expect(validate({ heroTitle: { ar: null, en: null } })).toBe(true);
  });

  it("REJECTS a field longer than its own limit", () => {
    for (const field of SITE_CONTENT_FIELDS) {
      const tooLong = "x".repeat(SITE_CONTENT_LIMITS[field] + 1);
      expect(validate({ [field]: { ar: tooLong, en: "ok" } })).toBe(false);
    }
  });

  it("accepts a field exactly at its limit", () => {
    for (const field of SITE_CONTENT_FIELDS) {
      const exact = "x".repeat(SITE_CONTENT_LIMITS[field]);
      expect(validate({ [field]: { ar: exact, en: exact } })).toBe(true);
    }
  });

  it("REJECTS an unknown field", () => {
    expect(validate({ notAField: text("x") })).toBe(false);
  });

  it("REJECTS a bare string where a language pair belongs", () => {
    expect(validate({ heroTitle: "Hello" })).toBe(false);
  });

  it("REJECTS a nested object — there is no structure to render", () => {
    expect(validate({ heroTitle: { ar: { nested: true }, en: "x" } })).toBe(false);
  });

  it("REJECTS an array and a primitive at the root", () => {
    expect(validate([])).toBe(false);
    expect(validate("text")).toBe(false);
    expect(validate(null)).toBe(false);
    expect(validate(42)).toBe(false);
  });
});

describe("header navigation accepts only taxonomy ids", () => {
  const validate = SETTINGS_REGISTRY[HEADER_NAV_SETTING_KEY].validate;

  it("accepts an empty list", () => {
    expect(validate([])).toBe(true);
  });

  it("accepts ids up to the maximum", () => {
    const ids = Array.from(
      { length: HEADER_NAV_MAX_ITEMS },
      (_, index) => `1111111${index}-1111-4111-8111-111111111111`
    );
    expect(validate(ids)).toBe(true);
  });

  it("REJECTS more than the maximum", () => {
    const ids = Array.from(
      { length: HEADER_NAV_MAX_ITEMS + 1 },
      (_, index) => `1111111${index}-1111-4111-8111-11111111111${index % 10}`
    );
    expect(validate(ids)).toBe(false);
  });

  it("REJECTS a URL — this is the whole point of the shape", () => {
    // A navigation that could hold a destination would need an
    // allowlist, and an allowlist is a thing that gets widened.
    expect(validate(["https://example.com"])).toBe(false);
    expect(validate(["/opportunities"])).toBe(false);
    expect(validate(["javascript:alert(1)"])).toBe(false);
  });

  it("REJECTS a duplicate id", () => {
    expect(validate([UUID, UUID])).toBe(false);
  });

  it("accepts distinct ids", () => {
    expect(validate([UUID, OTHER_UUID])).toBe(true);
  });

  it("REJECTS anything that is not an array of strings", () => {
    expect(validate({})).toBe(false);
    expect(validate([1, 2])).toBe(false);
    expect(validate([null])).toBe(false);
    expect(validate("id")).toBe(false);
  });
});

describe("no registered setting names a secret", () => {
  it("no key contains a forbidden word", () => {
    for (const key of Object.keys(SETTINGS_REGISTRY)) {
      for (const forbidden of SETTINGS_FORBIDDEN_FIELDS) {
        expect(key.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("every registered setting declares whether an admin may write it", () => {
    // `adminWritable` is the field the portal honours to decide whether
    // to draw an editor at all. A setting that omitted it would render
    // as undefined — falsy — and silently become read-only, which is
    // the safe direction but not a decision anybody made.
    for (const definition of Object.values(SETTINGS_REGISTRY)) {
      expect(typeof definition.adminWritable).toBe("boolean");
      expect(typeof definition.description).toBe("string");
      expect(definition.description.length).toBeGreaterThan(20);
    }
  });
});
