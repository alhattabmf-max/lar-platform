import { FinancialSettingsService } from "./financial-settings.service";
import { SettingsService } from "./settings.service";

function fakeSettings(behavior: "fallback" | "value", value?: unknown) {
  const settings = Object.create(SettingsService.prototype) as SettingsService;
  settings.getJsonSafe = jest.fn(async (_key, validate, fallback) => {
    if (behavior === "fallback") return fallback;
    const validated = validate(value);
    return validated === null ? fallback : validated;
  }) as never;
  return settings;
}

describe("FinancialSettingsService", () => {
  it("returns the hardcoded default (3 days) when unreadable", async () => {
    const service = new FinancialSettingsService({} as never, fakeSettings("fallback"), {} as never);
    await expect(service.getPayoutHoldDays()).resolves.toBe(3);
  });

  it("returns a valid stored value within bounds", async () => {
    const service = new FinancialSettingsService({} as never, fakeSettings("value", 7), {} as never);
    await expect(service.getPayoutHoldDays()).resolves.toBe(7);
  });

  it("rejects writing 0 — the setting can never disable the hold", async () => {
    const service = new FinancialSettingsService(
      { systemSetting: { findUnique: jest.fn(), upsert: jest.fn() } } as never,
      fakeSettings("fallback"),
      { log: jest.fn() } as never
    );
    await expect(
      service.setPayoutHoldDays(0, { actorId: "admin-1", requestId: "req-1" })
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("rejects writing above the maximum (30)", async () => {
    const service = new FinancialSettingsService(
      { systemSetting: { findUnique: jest.fn(), upsert: jest.fn() } } as never,
      fakeSettings("fallback"),
      { log: jest.fn() } as never
    );
    await expect(
      service.setPayoutHoldDays(31, { actorId: "admin-1", requestId: "req-1" })
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("accepts and persists a value within bounds, audited", async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const service = new FinancialSettingsService(
      { systemSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert } } as never,
      fakeSettings("fallback"),
      { log: auditLog } as never
    );

    await service.setPayoutHoldDays(5, { actorId: "admin-1", requestId: "req-1" });

    expect(upsert).toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PAYOUT_HOLD_DAYS_UPDATED" })
    );
  });
});
