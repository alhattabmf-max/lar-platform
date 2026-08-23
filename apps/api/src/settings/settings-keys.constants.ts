import { HEADER_NAV_SETTING_KEY, SITE_CONTENT_SETTING_KEY } from "@platform/types";

/**
 * Every key the settings machinery knows by name.
 *
 * The two site-content keys are taken from the SHARED contract rather
 * than retyped here. Both sides need the same literals — the API
 * registers them, and the admin portal writes to
 * `PUT /admin/settings/{key}` — and a second copy is how the portal ends
 * up writing to a key nothing reads: the write succeeds, the screen
 * reports success, and the site never changes.
 */
export const SETTINGS_KEYS = {
  EMAIL_VERIFICATION_ENABLED: "email_verification_enabled",
  COMPANY_VERIFICATION_MODE: "company_verification_mode",
  HOMEPAGE_CONTENT: SITE_CONTENT_SETTING_KEY,
  HEADER_NAV: HEADER_NAV_SETTING_KEY,
} as const;
