import { SettingsService } from "./settings.service";

function fakePrisma(row: unknown) {
  return {
    systemSetting: {
      findUnique: jest.fn().mockResolvedValue(row),
    },
  } as never;
}

describe("SettingsService", () => {
  it("returns the fallback when the key is absent (normal bootstrap state)", async () => {
    const service = new SettingsService(fakePrisma(null));
    await expect(service.getBoolean("some_flag", true)).resolves.toBe(true);
    await expect(service.getBoolean("some_flag", false)).resolves.toBe(false);
  });

  it("returns the stored value when it matches the expected type", async () => {
    const service = new SettingsService(fakePrisma({ key: "some_flag", value: true }));
    await expect(service.getBoolean("some_flag", false)).resolves.toBe(true);
  });

  it("throws (never silently falls back) when the stored value has the wrong type", async () => {
    const service = new SettingsService(fakePrisma({ key: "some_flag", value: "yes" }));
    await expect(service.getBoolean("some_flag", false)).rejects.toThrow();
  });

  it("propagates a database read failure instead of swallowing it into the fallback", async () => {
    const prisma = {
      systemSetting: {
        findUnique: jest.fn().mockRejectedValue(new Error("connection refused")),
      },
    } as never;
    const service = new SettingsService(prisma);
    await expect(service.getBoolean("some_flag", false)).rejects.toThrow("connection refused");
  });

  it("getString follows the same fail-safe contract", async () => {
    const missing = new SettingsService(fakePrisma(null));
    await expect(missing.getString("mode", "MANUAL")).resolves.toBe("MANUAL");

    const malformed = new SettingsService(fakePrisma({ key: "mode", value: 123 }));
    await expect(malformed.getString("mode", "MANUAL")).rejects.toThrow();
  });
});
