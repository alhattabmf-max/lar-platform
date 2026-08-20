import { BannerPolicyService, type BannerPolicyConfig } from "./banner-policy.service";
import { BusinessException } from "../common/errors/business-exception";
import type { PrismaService } from "../database/prisma.service";
import type { SettingsService } from "./settings.service";
import type { AuditService } from "../audit/audit.service";

const VALID: BannerPolicyConfig = {
  maxSizeBytes: 2 * 1024 * 1024,
  maxPixels: 8_000_000,
  allowedTypes: ["image/jpeg", "image/png", "image/webp"],
  maxConcurrentLiveBannersPerPlacement: 3,
};

function makeService() {
  const findUnique = jest.fn().mockResolvedValue(null);
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = { systemSetting: { findUnique, upsert } } as unknown as PrismaService;

  // Captures the validator so the bounds can be probed directly.
  let capturedValidate: ((value: unknown) => BannerPolicyConfig | null) | null = null;
  const settings = {
    getJsonSafe: jest.fn(
      async (_key: string, validate: (v: unknown) => BannerPolicyConfig | null, fallback: BannerPolicyConfig) => {
        capturedValidate = validate;
        return fallback;
      }
    ),
  } as unknown as SettingsService;

  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    service: new BannerPolicyService(prisma, settings, audit),
    upsert,
    audit,
    validateVia: async () => {
      await new BannerPolicyService(prisma, settings, audit).getPolicy();
      return capturedValidate!;
    },
  };
}

const CTX = { actorId: "admin-1", requestId: "req-1" };

describe("maxConcurrentLiveBannersPerPlacement bounds", () => {
  it("REFUSES zero — disabling every banner via the limit is not a supported control", async () => {
    const { service, upsert } = makeService();

    await expect(
      service.setPolicy({ ...VALID, maxConcurrentLiveBannersPerPlacement: 0 }, CTX)
    ).rejects.toBeInstanceOf(BusinessException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a negative limit", async () => {
    const { service } = makeService();

    await expect(
      service.setPolicy({ ...VALID, maxConcurrentLiveBannersPerPlacement: -1 }, CTX)
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("refuses a non-integer limit", async () => {
    const { service } = makeService();

    await expect(
      service.setPolicy({ ...VALID, maxConcurrentLiveBannersPerPlacement: 2.5 }, CTX)
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("accepts the minimum of one", async () => {
    const { service, upsert } = makeService();

    await service.setPolicy({ ...VALID, maxConcurrentLiveBannersPerPlacement: 1 }, CTX);

    expect(upsert).toHaveBeenCalled();
  });

  it("refuses a limit above the maximum", async () => {
    const { service } = makeService();

    await expect(
      service.setPolicy({ ...VALID, maxConcurrentLiveBannersPerPlacement: 11 }, CTX)
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("a stored zero is treated as malformed and falls back to the default", async () => {
    const { validateVia } = makeService();
    const validate = await validateVia();

    expect(validate({ ...VALID, maxConcurrentLiveBannersPerPlacement: 0 })).toBeNull();
    expect(validate(VALID)).not.toBeNull();
  });
});

describe("image bounds", () => {
  it("refuses a size above the shared 20 MB transport ceiling", async () => {
    const { service } = makeService();

    await expect(
      service.setPolicy({ ...VALID, maxSizeBytes: 21 * 1024 * 1024 }, CTX)
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("refuses a type the processor cannot emit", async () => {
    const { service } = makeService();

    for (const type of ["image/svg+xml", "image/gif", "text/html"]) {
      await expect(
        service.setPolicy({ ...VALID, allowedTypes: [type] }, CTX)
      ).rejects.toBeInstanceOf(BusinessException);
    }
  });

  it("refuses an empty allowlist, which would silently block all uploads", async () => {
    const { service } = makeService();

    await expect(service.setPolicy({ ...VALID, allowedTypes: [] }, CTX)).rejects.toBeInstanceOf(
      BusinessException
    );
  });
});

describe("audit", () => {
  it("records an accepted policy change", async () => {
    const { service, audit } = makeService();

    await service.setPolicy(VALID, CTX);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "BANNER_POLICY_UPDATED", entityType: "system_setting" })
    );
  });

  it("records nothing when the value is refused", async () => {
    const { service, audit } = makeService();

    await expect(
      service.setPolicy({ ...VALID, maxConcurrentLiveBannersPerPlacement: 0 }, CTX)
    ).rejects.toBeInstanceOf(BusinessException);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
