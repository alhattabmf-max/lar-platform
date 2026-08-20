import { SETTINGS_REGISTRY, getSettingDefinition } from "./settings-registry";
import { SETTINGS_KEYS } from "../../settings/settings-keys.constants";

describe("SETTINGS_REGISTRY", () => {
  it("only registers the two known generic settings, never rate-limit/session keys", () => {
    const keys = Object.keys(SETTINGS_REGISTRY);
    expect(keys).toEqual(
      expect.arrayContaining([
        SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED,
        SETTINGS_KEYS.COMPANY_VERIFICATION_MODE,
      ])
    );
    expect(keys).not.toContain("admin_login_rate_limit");
    expect(keys).not.toContain("admin_2fa_rate_limit");
    expect(keys).not.toContain("admin_session_duration_seconds");
  });

  it("returns undefined for unregistered keys", () => {
    expect(getSettingDefinition("not_a_real_setting")).toBeUndefined();
  });

  describe("email_verification_enabled validator", () => {
    const def = SETTINGS_REGISTRY[SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED];

    it("accepts booleans", () => {
      expect(def.validate(true)).toBe(true);
      expect(def.validate(false)).toBe(true);
    });

    it("rejects non-boolean values", () => {
      expect(def.validate("true")).toBe(false);
      expect(def.validate(1)).toBe(false);
      expect(def.validate(null)).toBe(false);
      expect(def.validate({})).toBe(false);
    });
  });

  describe("company_verification_mode validator", () => {
    const def = SETTINGS_REGISTRY[SETTINGS_KEYS.COMPANY_VERIFICATION_MODE];

    it("accepts only MANUAL or AUTOMATIC", () => {
      expect(def.validate("MANUAL")).toBe(true);
      expect(def.validate("AUTOMATIC")).toBe(true);
    });

    it("rejects any other value", () => {
      expect(def.validate("automatic")).toBe(false);
      expect(def.validate("DELETE_EVERYTHING")).toBe(false);
      expect(def.validate(true)).toBe(false);
    });
  });
});
