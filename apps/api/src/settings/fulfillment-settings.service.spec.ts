import { FulfillmentSettingsService } from "./fulfillment-settings.service";

function buildMocks() {
  const store = new Map<string, unknown>();
  const prisma = {
    systemSetting: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => {
        const value = store.get(where.key);
        return value === undefined ? null : { key: where.key, value, updatedBy: "u1" };
      }),
      upsert: jest.fn(async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
        store.set(where.key, create.value);
        return { key: where.key, value: create.value };
      }),
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  return { prisma, audit, store };
}

describe("FulfillmentSettingsService", () => {
  it("returns the default config (100/130) when no row exists yet", async () => {
    const { prisma, audit } = buildMocks();
    const service = new FulfillmentSettingsService(prisma as never, audit as never);
    const config = await service.getConfig();
    expect(config).toEqual({ lateThresholdPercent: 100, criticalThresholdPercent: 130 });
  });

  it("persists a valid config and returns it on subsequent reads", async () => {
    const { prisma, audit } = buildMocks();
    const service = new FulfillmentSettingsService(prisma as never, audit as never);
    await service.setConfig({ lateThresholdPercent: 110, criticalThresholdPercent: 150 }, { actorId: "admin1", requestId: "r1" });
    const config = await service.getConfig();
    expect(config).toEqual({ lateThresholdPercent: 110, criticalThresholdPercent: 150 });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it("rejects lateThresholdPercent below 100", async () => {
    const { prisma, audit } = buildMocks();
    const service = new FulfillmentSettingsService(prisma as never, audit as never);
    await expect(
      service.setConfig({ lateThresholdPercent: 99, criticalThresholdPercent: 130 }, { actorId: "admin1", requestId: "r1" })
    ).rejects.toThrow();
  });

  it("accepts lateThresholdPercent exactly at the 100 boundary", async () => {
    const { prisma, audit } = buildMocks();
    const service = new FulfillmentSettingsService(prisma as never, audit as never);
    await expect(
      service.setConfig({ lateThresholdPercent: 100, criticalThresholdPercent: 130 }, { actorId: "admin1", requestId: "r1" })
    ).resolves.toBeUndefined();
  });

  it("rejects criticalThresholdPercent equal to lateThresholdPercent (must be strictly greater)", async () => {
    const { prisma, audit } = buildMocks();
    const service = new FulfillmentSettingsService(prisma as never, audit as never);
    await expect(
      service.setConfig({ lateThresholdPercent: 120, criticalThresholdPercent: 120 }, { actorId: "admin1", requestId: "r1" })
    ).rejects.toThrow();
  });

  it("rejects criticalThresholdPercent below lateThresholdPercent", async () => {
    const { prisma, audit } = buildMocks();
    const service = new FulfillmentSettingsService(prisma as never, audit as never);
    await expect(
      service.setConfig({ lateThresholdPercent: 130, criticalThresholdPercent: 110 }, { actorId: "admin1", requestId: "r1" })
    ).rejects.toThrow();
  });

  it("rejects a value above the max bound (1000)", async () => {
    const { prisma, audit } = buildMocks();
    const service = new FulfillmentSettingsService(prisma as never, audit as never);
    await expect(
      service.setConfig({ lateThresholdPercent: 100, criticalThresholdPercent: 1001 }, { actorId: "admin1", requestId: "r1" })
    ).rejects.toThrow();
  });

  it("does not persist anything when validation fails", async () => {
    const { prisma, audit, store } = buildMocks();
    const service = new FulfillmentSettingsService(prisma as never, audit as never);
    await expect(
      service.setConfig({ lateThresholdPercent: 50, criticalThresholdPercent: 60 }, { actorId: "admin1", requestId: "r1" })
    ).rejects.toThrow();
    expect(store.size).toBe(0);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
