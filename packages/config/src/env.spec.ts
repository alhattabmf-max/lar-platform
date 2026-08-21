import { loadEnv } from "./env";

function baseEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://platform:platform@localhost:5432/platform_dev",
    REDIS_URL: "redis://localhost:6379",
    ADMIN_TOTP_ENCRYPTION_KEY: "a".repeat(64),
    BANK_DATA_ENCRYPTION_KEY: "b".repeat(64),
    STORAGE_ENDPOINT: "http://localhost:9000",
    STORAGE_REGION: "us-east-1",
    STORAGE_ACCESS_KEY: "access",
    STORAGE_SECRET_KEY: "secret",
    STORAGE_BUCKET_NAME: "platform-dev",
  };
}

describe("loadEnv", () => {
  it("parses a valid minimal environment and applies defaults", () => {
    const env = loadEnv(baseEnv());

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.TZ).toBe("UTC");
    expect(env.DEFAULT_DISPLAY_TIMEZONE).toBe("Asia/Riyadh");
    expect(env.EMAIL_PROVIDER_MODE).toBe("mock");
    expect(env.MAP_PROVIDER_MODE).toBe("manual");
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([]);
  });

  describe("EMAIL_REQUIRED", () => {
    it("defaults to false, so every existing deployment still boots", () => {
      // The only provider mode is "mock". Defaulting this to true would
      // refuse to start every production process on the day it shipped.
      expect(loadEnv(baseEnv()).EMAIL_REQUIRED).toBe(false);
    });

    it("parses the string 'true' into a real boolean", () => {
      expect(loadEnv({ ...baseEnv(), EMAIL_REQUIRED: "true" }).EMAIL_REQUIRED).toBe(true);
    });

    it("parses the string 'false' into a real boolean", () => {
      expect(loadEnv({ ...baseEnv(), EMAIL_REQUIRED: "false" }).EMAIL_REQUIRED).toBe(false);
    });

    it.each(["yes", "1", "TRUE", "on", ""])(
      "rejects %p rather than silently reading it as false",
      (value) => {
        // A typo'd "1" quietly meaning false is exactly how a
        // deployment ends up believing email is guaranteed when it is
        // not.
        expect(() => loadEnv({ ...baseEnv(), EMAIL_REQUIRED: value })).toThrow(/EMAIL_REQUIRED/);
      }
    );
  });

  it("throws a descriptive error when a required variable is missing", () => {
    const { DATABASE_URL: _omit, ...rest } = baseEnv();
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is not a valid URL", () => {
    const env = { ...baseEnv(), DATABASE_URL: "not-a-url" };
    expect(() => loadEnv(env)).toThrow(/DATABASE_URL/);
  });

  it("parses a comma-separated CORS origin list into an array", () => {
    const env = loadEnv({
      ...baseEnv(),
      CORS_ALLOWED_ORIGINS: "http://localhost:3001, http://localhost:3002",
    });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([
      "http://localhost:3001",
      "http://localhost:3002",
    ]);
  });

  it("rejects a TZ value other than UTC", () => {
    const env = { ...baseEnv(), TZ: "Asia/Riyadh" };
    expect(() => loadEnv(env)).toThrow();
  });

  it("rejects reusing the Admin TOTP key for supplier bank data", () => {
    const env = {
      ...baseEnv(),
      BANK_DATA_ENCRYPTION_KEY: baseEnv().ADMIN_TOTP_ENCRYPTION_KEY,
    };
    expect(() => loadEnv(env)).toThrow(/independent/);
  });
});
