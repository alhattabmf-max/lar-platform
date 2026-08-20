import { MediaPolicyService, MEDIA_SIZE_HARD_CEILING_BYTES } from "./media-policy.service";
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

const validPolicy = {
  maxSizeBytes: 5 * 1024 * 1024,
  maxImagesPerProduct: 10,
  allowedTypes: ["image/jpeg", "image/png"],
  maxPixels: 40_000_000,
};

describe("MediaPolicyService", () => {
  it("returns the hardcoded default when unreadable", async () => {
    const service = new MediaPolicyService({} as never, fakeSettings("fallback"), {} as never);
    const result = await service.getPolicy();
    expect(result.maxSizeBytes).toBe(5 * 1024 * 1024);
    expect(result.maxImagesPerProduct).toBe(10);
  });

  it("returns a valid stored policy when present", async () => {
    const service = new MediaPolicyService({} as never, fakeSettings("value", validPolicy), {} as never);
    const result = await service.getPolicy();
    expect(result).toEqual(validPolicy);
  });

  it("rejects a write above the hard ceiling (max bound)", async () => {
    const service = new MediaPolicyService(
      { systemSetting: { findUnique: jest.fn(), upsert: jest.fn() } } as never,
      fakeSettings("fallback"),
      { log: jest.fn() } as never
    );
    await expect(
      service.setPolicy(
        { ...validPolicy, maxSizeBytes: MEDIA_SIZE_HARD_CEILING_BYTES + 1 },
        { actorId: "admin-1", requestId: "req-1" }
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("accepts a write exactly at the hard ceiling", async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const service = new MediaPolicyService(
      { systemSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert } } as never,
      fakeSettings("fallback"),
      { log: jest.fn() } as never
    );
    await expect(
      service.setPolicy(
        { ...validPolicy, maxSizeBytes: MEDIA_SIZE_HARD_CEILING_BYTES },
        { actorId: "admin-1", requestId: "req-1" }
      )
    ).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalled();
  });

  it("rejects a disallowed content type not in the code's supported set", async () => {
    const service = new MediaPolicyService(
      { systemSetting: { findUnique: jest.fn(), upsert: jest.fn() } } as never,
      fakeSettings("fallback"),
      { log: jest.fn() } as never
    );
    await expect(
      service.setPolicy(
        { ...validPolicy, allowedTypes: ["image/gif"] },
        { actorId: "admin-1", requestId: "req-1" }
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("rejects maxImagesPerProduct outside bounds", async () => {
    const service = new MediaPolicyService(
      { systemSetting: { findUnique: jest.fn(), upsert: jest.fn() } } as never,
      fakeSettings("fallback"),
      { log: jest.fn() } as never
    );
    await expect(
      service.setPolicy(
        { ...validPolicy, maxImagesPerProduct: 999 },
        { actorId: "admin-1", requestId: "req-1" }
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });
});
