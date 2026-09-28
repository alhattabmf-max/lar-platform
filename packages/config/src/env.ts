import { z } from "zod";

/**
 * Zod = a schema/validation library. We use it here so every service
 * fails fast and loudly at startup if a required environment variable
 * is missing or malformed, instead of crashing later on first use deep
 * inside a request.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),

    // Timezone: the process always runs in UTC. DEFAULT_DISPLAY_TIMEZONE is
    // an IANA timezone name (e.g. "Asia/Riyadh") used only when formatting
    // a stored UTC timestamp for human display.
    TZ: z.literal("UTC").default("UTC"),
    DEFAULT_DISPLAY_TIMEZONE: z.string().min(1).default("Asia/Riyadh"),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    // AES-256-GCM key (32 bytes, hex-encoded = 64 hex chars) used to
    // encrypt Admin 2FA TOTP secrets at rest. Never derived from a
    // password or stored anywhere but the process environment/secrets
    // manager.
    ADMIN_TOTP_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "must be a 64-character hex string (32 bytes)"),

    // Independent AES-256-GCM key for supplier bank data (IBAN) at
    // rest — deliberately a SEPARATE key from ADMIN_TOTP_ENCRYPTION_KEY
    // (different trust domain / blast radius). Envelope-encrypted with
    // a key-version prefix so a future key rotation never requires a
    // schema change — see common/security/crypto-envelope.util.ts.
    BANK_DATA_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "must be a 64-character hex string (32 bytes)"),

    // THE NAME AN ADMINISTRATOR SEES IN THEIR AUTHENTICATOR APP.
    //
    // It was the literal string `PROJECT_NAME Admin`, hard-coded, and
    // it reached every enrolment: the otpauth URI read
    // `issuer=PROJECT_NAME%20Admin`, which is what the app shows
    // beside the six digits, for ever.
    //
    // READ AT START-UP, NEVER AT ENROLMENT. The platform's real trade
    // name lives in `branding_settings`, but a QR that depends on a
    // database read is a QR that can fail while somebody is standing
    // in front of it. This is resolved once, when the process boots.
    //
    // CHANGING IT BREAKS NOTHING. Verification is the secret and the
    // clock — see `verifyTotpCode`, which never receives an issuer —
    // so an administrator enrolled under the old name keeps signing in
    // unchanged, and only new enrolments carry the new one.
    ADMIN_TOTP_ISSUER: z
      .string()
      .trim()
      .min(1, "must not be empty")
      // Authenticator apps truncate long issuers, and the string is
      // stamped into an enrolment that is never revisited.
      .max(64, "must be 64 characters or fewer")
      .default("Azier Plus Admin"),

    STORAGE_ENDPOINT: z.string().url(),
    STORAGE_REGION: z.string().min(1),
    STORAGE_ACCESS_KEY: z.string().min(1),
    STORAGE_SECRET_KEY: z.string().min(1),
    STORAGE_BUCKET_NAME: z.string().min(1),
    STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

    EMAIL_PROVIDER_MODE: z.enum(["mock"]).default("mock"),

    /**
     * Whether this deployment depends on email actually being
     * delivered.
     *
     * Defaults to FALSE, which is what keeps every existing deployment
     * booting unchanged: today the only provider mode is `mock`, so a
     * default of true would refuse to start every production process.
     *
     * Setting it true in production asserts "email must work here", and
     * `assertEmailDeliveryConfigured` then refuses to boot against a
     * provider that delivers nothing. See that function for why the
     * check is a boot failure rather than a warning.
     */
    EMAIL_REQUIRED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    MAP_PROVIDER_MODE: z.enum(["manual"]).default("manual"),

    CORS_ALLOWED_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
  })
  .superRefine((env, ctx) => {
    if (env.BANK_DATA_ENCRYPTION_KEY === env.ADMIN_TOTP_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BANK_DATA_ENCRYPTION_KEY"],
        message: "must be independent from ADMIN_TOTP_ENCRYPTION_KEY",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env` (or any env-like record passed in,
 * useful for testing). Throws a descriptive error immediately if
 * validation fails — callers should invoke this once at process startup.
 */
export function loadEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
