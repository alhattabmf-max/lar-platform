import { ShippingTariffPolicyService } from "./shipping-tariff-policy.service";

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    shippingTariffPolicyVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn(),
      ...(overrides.shippingTariffPolicyVersion as Record<string, unknown> | undefined),
    },
  } as never;
}

const auditStub = { log: jest.fn().mockResolvedValue(undefined) } as never;

describe("ShippingTariffPolicyService", () => {
  it("getCurrentPolicy() rejects with SHIPPING_TARIFF_NOT_CONFIGURED when no version row exists, and never invents a default", async () => {
    const prisma = fakePrisma();
    const service = new ShippingTariffPolicyService(prisma, auditStub);

    await expect(service.getCurrentPolicy()).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SHIPPING_TARIFF_NOT_CONFIGURED" }),
    });
  });

  it("getCurrentPolicy() returns the latest version when one exists", async () => {
    const row = {
      id: "tariff-1",
      version: 2,
      sameCityFeeAmount: { toString: () => "10" },
      sameRegionDifferentCityFeeAmount: { toString: () => "20" },
      differentRegionFeeAmount: { toString: () => "30" },
      providerCode: "ADMIN_TARIFF_V1",
    };
    const prisma = fakePrisma({ shippingTariffPolicyVersion: { findFirst: jest.fn().mockResolvedValue(row) } });
    const service = new ShippingTariffPolicyService(prisma, auditStub);

    const result = await service.getCurrentPolicy();
    expect(result).toEqual({
      id: "tariff-1",
      version: 2,
      sameCityFeeAmount: 10,
      sameRegionDifferentCityFeeAmount: 20,
      differentRegionFeeAmount: 30,
      providerCode: "ADMIN_TARIFF_V1",
    });
  });

  it("setPolicy() rejects negative amounts", async () => {
    const prisma = fakePrisma();
    const service = new ShippingTariffPolicyService(prisma, auditStub);

    await expect(
      service.setPolicy({ sameCityFeeAmount: -1, sameRegionDifferentCityFeeAmount: 20, differentRegionFeeAmount: 30 }, {
        actorId: "admin-1",
        requestId: "req-1",
      })
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });
});
