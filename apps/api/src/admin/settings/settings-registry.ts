import { SETTINGS_KEYS } from "../../settings/settings-keys.constants";

export type SettingValueType = "boolean" | "enum";

export interface SettingDefinition {
  key: string;
  type: SettingValueType;
  description: string;
  adminWritable: boolean;
  /**
   * Documents which SettingsService read contract applies to this key —
   * "throw-on-malformed" (getBoolean/getString: a corrupted value fails
   * loudly) vs "safe-default-on-failure" (getJsonSafe: never disables
   * protection). Informational here; the actual behavior lives in
   * whichever service reads the key.
   */
  failSafeBehavior: "throw-on-malformed" | "safe-default-on-failure";
  allowedValues?: readonly string[];
  validate: (value: unknown) => boolean;
}

/**
 * Registry of settings reachable through the GENERIC admin settings
 * endpoint (GET/PUT /admin/settings/:key). This is deliberately a
 * short, explicit allow-list — NOT a passthrough to the
 * system_settings table. A key absent from this map can never be
 * written (or read) through the generic endpoint, full stop.
 *
 * Rate limits, 2FA rate limit, and session duration are NOT registered
 * here on purpose: they are security-bounded settings with their own
 * min/max validation and belong exclusively to
 * SecuritySettingsService + its dedicated /admin/settings/security/*
 * endpoints. Registering them here too would create a second,
 * unvalidated way to write the same value — exactly what this
 * registry exists to prevent.
 */
export const SETTINGS_REGISTRY: Record<string, SettingDefinition> = {
  [SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED]: {
    key: SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED,
    type: "boolean",
    description:
      "Gates whether new registrations require email verification before login (Phase 2). Missing key defaults to false (getBoolean fallback); a malformed stored value throws rather than silently disabling verification.",
    adminWritable: true,
    failSafeBehavior: "throw-on-malformed",
    validate: (value) => typeof value === "boolean",
  },
  [SETTINGS_KEYS.COMPANY_VERIFICATION_MODE]: {
    key: SETTINGS_KEYS.COMPANY_VERIFICATION_MODE,
    type: "enum",
    description:
      "MANUAL (default) requires admin approve/reject of supplier companies; AUTOMATIC calls the Verification Provider on registration.",
    adminWritable: true,
    failSafeBehavior: "throw-on-malformed",
    allowedValues: ["MANUAL", "AUTOMATIC"],
    validate: (value) => value === "MANUAL" || value === "AUTOMATIC",
  },
};

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS_REGISTRY[key];
}
