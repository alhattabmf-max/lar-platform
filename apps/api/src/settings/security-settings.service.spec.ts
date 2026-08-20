import { SecuritySettingsService } from "./security-settings.service";
import { SettingsService } from "./settings.service";

function fakeSettingsService(behavior: "returnFallback" | "returnValue", value?: unknown) {
  const settings = Object.create(SettingsService.prototype) as SettingsService;
  settings.getJsonSafe = jest.fn(async (_key, validate, fallback) => {
    if (behavior === "returnFallback") return fallback;
    const validated = validate(value);
    return validated === null ? fallback : validated;
  }) as never;
  return settings;
}

describe("SecuritySettingsService", () => {
  describe("reads — fail-safe to hardcoded defaults", () => {
    it("returns the hardcoded default rate limit when the setting is unreadable", async () => {
      const service = new SecuritySettingsService(
        {} as never,
        fakeSettingsService("returnFallback"),
        {} as never
      );
      const result = await service.getAdminLoginRateLimit();
      expect(result).toEqual({ limit: 5, ttlSeconds: 60 });
    });

    it("returns a valid stored rate limit when present and within bounds", async () => {
      const service = new SecuritySettingsService(
        {} as never,
        fakeSettingsService("returnValue", { limit: 10, ttlSeconds: 120 }),
        {} as never
      );
      const result = await service.getAdminLoginRateLimit();
      expect(result).toEqual({ limit: 10, ttlSeconds: 120 });
    });

    it("falls back to the default session duration when the stored value is malformed", async () => {
      const service = new SecuritySettingsService(
        {} as never,
        fakeSettingsService("returnValue", "not-a-number"),
        {} as never
      );
      const result = await service.getAdminSessionDurationSeconds();
      expect(result).toBe(60 * 60 * 8);
    });
  });

  describe("writes — rejected outside min/max bounds", () => {
    it("rejects a rate limit above the maximum allowed", async () => {
      const service = new SecuritySettingsService(
        { systemSetting: { findUnique: jest.fn(), upsert: jest.fn() } } as never,
        fakeSettingsService("returnFallback"),
        { log: jest.fn() } as never
      );
      await expect(
        service.setAdminLoginRateLimit(
          { limit: 999, ttlSeconds: 60 },
          { actorId: "admin-1", requestId: "req-1" }
        )
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("rejects a session duration below the minimum allowed", async () => {
      const service = new SecuritySettingsService(
        { systemSetting: { findUnique: jest.fn(), upsert: jest.fn() } } as never,
        fakeSettingsService("returnFallback"),
        { log: jest.fn() } as never
      );
      await expect(
        service.setAdminSessionDurationSeconds(10, { actorId: "admin-1", requestId: "req-1" })
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("accepts and persists a rate limit within bounds, and audits it", async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const findUnique = jest.fn().mockResolvedValue(null);
      const auditLog = jest.fn().mockResolvedValue(undefined);

      const service = new SecuritySettingsService(
        { systemSetting: { findUnique, upsert } } as never,
        fakeSettingsService("returnFallback"),
        { log: auditLog } as never
      );

      await service.setAdminLoginRateLimit(
        { limit: 8, ttlSeconds: 90 },
        { actorId: "admin-1", requestId: "req-1" }
      );

      expect(upsert).toHaveBeenCalled();
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "SECURITY_SETTING_UPDATED", actorId: "admin-1" })
      );
    });
  });
});
