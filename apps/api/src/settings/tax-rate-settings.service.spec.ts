import { TaxRateSettingsService } from "./tax-rate-settings.service";

function fakePrisma(overrides: {
  findUnique?: jest.Mock;
  upsert?: jest.Mock;
} = {}) {
  return {
    systemSetting: {
      findUnique: overrides.findUnique ?? jest.fn().mockResolvedValue(null),
      upsert: overrides.upsert ?? jest.fn().mockResolvedValue({}),
    },
  } as never;
}

const auditStub = { log: jest.fn().mockResolvedValue(undefined) } as never;
const ctx = { actorId: "admin-1", requestId: "req-1" };

describe("TaxRateSettingsService", () => {
  describe("getDefaultRate — absence is null, never a default rate", () => {
    it("returns null when the setting was never configured — never assumes 15% or any other rate", async () => {
      const service = new TaxRateSettingsService(fakePrisma(), auditStub);
      const result = await service.getDefaultRate();
      expect(result).toBeNull();
    });

    it("returns the stored config when it is valid and within bounds", async () => {
      const findUnique = jest.fn().mockResolvedValue({ value: { ratePercent: 15, version: 1 } });
      const service = new TaxRateSettingsService(fakePrisma({ findUnique }), auditStub);
      const result = await service.getDefaultRate();
      expect(result).toEqual({ ratePercent: 15, version: 1 });
    });
  });

  describe("getDefaultRate — malformed value never silently becomes null", () => {
    it("throws (does not resolve to null) when the stored value has an out-of-bounds rate", async () => {
      const findUnique = jest.fn().mockResolvedValue({ value: { ratePercent: 150, version: 1 } });
      const service = new TaxRateSettingsService(fakePrisma({ findUnique }), auditStub);
      await expect(service.getDefaultRate()).rejects.toThrow(/malformed value/);
    });

    it("throws when the stored value is missing required fields", async () => {
      const findUnique = jest.fn().mockResolvedValue({ value: { ratePercent: 15 } }); // no version
      const service = new TaxRateSettingsService(fakePrisma({ findUnique }), auditStub);
      await expect(service.getDefaultRate()).rejects.toThrow(/malformed value/);
    });
  });

  describe("getDefaultRate — a genuine DB read failure never silently becomes null", () => {
    it("propagates the error instead of resolving to null — distinguishable from 'not configured'", async () => {
      const findUnique = jest.fn().mockRejectedValue(new Error("connection terminated unexpectedly"));
      const service = new TaxRateSettingsService(fakePrisma({ findUnique }), auditStub);
      await expect(service.getDefaultRate()).rejects.toThrow("connection terminated unexpectedly");
    });
  });

  describe("setDefaultRate — bounds", () => {
    it("rejects a rate below 0", async () => {
      const service = new TaxRateSettingsService(fakePrisma(), auditStub);
      await expect(service.setDefaultRate(-1, ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
    });

    it("rejects a rate above 100", async () => {
      const service = new TaxRateSettingsService(fakePrisma(), auditStub);
      await expect(service.setDefaultRate(101, ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
    });

    it("rejects a non-numeric rate", async () => {
      const service = new TaxRateSettingsService(fakePrisma(), auditStub);
      await expect(service.setDefaultRate("15" as never, ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
    });

    it("accepts a valid rate within bounds (boundary values 0 and 100 included)", async () => {
      const service = new TaxRateSettingsService(fakePrisma(), auditStub);
      await expect(service.setDefaultRate(0, ctx)).resolves.toMatchObject({ ratePercent: 0 });
      await expect(service.setDefaultRate(100, ctx)).resolves.toMatchObject({ ratePercent: 100 });
    });
  });

  describe("setDefaultRate — recovering from a corrupted stored value", () => {
    it("overwrites a malformed existing value, restarting at version 1 (admin fixing corruption)", async () => {
      const findUnique = jest.fn().mockResolvedValue({ value: { ratePercent: "not-a-number" } });
      const upsert = jest.fn().mockResolvedValue({});
      const service = new TaxRateSettingsService(fakePrisma({ findUnique, upsert }), auditStub);
      const result = await service.setDefaultRate(15, ctx);
      expect(result).toEqual({ ratePercent: 15, version: 1 });
    });

    it("still blocks the write when the version-lookup read hits a genuine DB failure", async () => {
      const findUnique = jest.fn().mockRejectedValue(new Error("connection terminated unexpectedly"));
      const service = new TaxRateSettingsService(fakePrisma({ findUnique }), auditStub);
      await expect(service.setDefaultRate(15, ctx)).rejects.toThrow("connection terminated unexpectedly");
    });
  });

  describe("setDefaultRate — versioning and audit", () => {
    it("starts at version 1 when nothing was previously configured", async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const service = new TaxRateSettingsService(fakePrisma({ upsert }), auditStub);
      const result = await service.setDefaultRate(15, ctx);
      expect(result.version).toBe(1);
    });

    it("increments the version on every subsequent update", async () => {
      const findUnique = jest.fn().mockResolvedValue({ value: { ratePercent: 15, version: 3 } });
      const upsert = jest.fn().mockResolvedValue({});
      const service = new TaxRateSettingsService(fakePrisma({ findUnique, upsert }), auditStub);
      const result = await service.setDefaultRate(20, ctx);
      expect(result.version).toBe(4);
    });

    it("writes an audit log entry for every update", async () => {
      const auditLog = jest.fn().mockResolvedValue(undefined);
      const service = new TaxRateSettingsService(fakePrisma(), { log: auditLog } as never);
      await service.setDefaultRate(15, ctx);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DEFAULT_TAX_RATE_UPDATED",
          actorId: "admin-1",
          entityType: "system_setting",
        })
      );
    });
  });
});
