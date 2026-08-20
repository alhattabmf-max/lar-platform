import { OpportunitySettingsService } from "./opportunity-settings.service";

const VALID_CONFIG = {
  minDurationHours: 24,
  maxDurationDays: 30,
  minTargetQuantity: 1,
  maxTargetQuantity: 1_000_000,
  showScheduledPubliclyEnabled: false,
};

const DEFAULT_CONFIG = VALID_CONFIG;

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

describe("OpportunitySettingsService", () => {
  describe("getConfig — ONLY a missing row falls back to the default", () => {
    it("returns the hardcoded default when the setting was never configured (row absent)", async () => {
      const service = new OpportunitySettingsService(fakePrisma(), auditStub);
      await expect(service.getConfig()).resolves.toEqual(DEFAULT_CONFIG);
    });

    it("returns a valid stored config when present and within bounds", async () => {
      const stored = { ...VALID_CONFIG, minDurationHours: 48, showScheduledPubliclyEnabled: true };
      const findUnique = jest.fn().mockResolvedValue({ value: stored });
      const service = new OpportunitySettingsService(fakePrisma({ findUnique }), auditStub);
      await expect(service.getConfig()).resolves.toEqual(stored);
    });
  });

  describe("getConfig — malformed stored value never silently falls back", () => {
    it("throws (does not resolve to the default) when a field is the wrong type", async () => {
      const malformed = { ...VALID_CONFIG, minDurationHours: "not-a-number" };
      const findUnique = jest.fn().mockResolvedValue({ value: malformed });
      const service = new OpportunitySettingsService(fakePrisma({ findUnique }), auditStub);
      await expect(service.getConfig()).rejects.toThrow(/malformed value/);
    });

    it("throws when a value is present but fails bounds/consistency checks", async () => {
      const malformed = { ...VALID_CONFIG, maxTargetQuantity: 0 }; // below minTargetQuantity
      const findUnique = jest.fn().mockResolvedValue({ value: malformed });
      const service = new OpportunitySettingsService(fakePrisma({ findUnique }), auditStub);
      await expect(service.getConfig()).rejects.toThrow(/malformed value/);
    });
  });

  describe("getConfig — a genuine DB read failure never silently falls back", () => {
    it("propagates the error instead of resolving to the default", async () => {
      const findUnique = jest.fn().mockRejectedValue(new Error("connection terminated unexpectedly"));
      const service = new OpportunitySettingsService(fakePrisma({ findUnique }), auditStub);
      await expect(service.getConfig()).rejects.toThrow("connection terminated unexpectedly");
    });
  });

  describe("setConfig — bounds", () => {
    it("rejects minDurationHours below the minimum bound", async () => {
      const service = new OpportunitySettingsService(fakePrisma(), auditStub);
      await expect(
        service.setConfig({ ...VALID_CONFIG, minDurationHours: 0 }, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("rejects maxDurationDays above the maximum bound", async () => {
      const service = new OpportunitySettingsService(fakePrisma(), auditStub);
      await expect(
        service.setConfig({ ...VALID_CONFIG, maxDurationDays: 91 }, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("rejects minTargetQuantity below 1", async () => {
      const service = new OpportunitySettingsService(fakePrisma(), auditStub);
      await expect(
        service.setConfig({ ...VALID_CONFIG, minTargetQuantity: 0 }, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("rejects maxTargetQuantity above its bound", async () => {
      const service = new OpportunitySettingsService(fakePrisma(), auditStub);
      await expect(
        service.setConfig({ ...VALID_CONFIG, maxTargetQuantity: 10_000_001 }, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("rejects maxTargetQuantity less than minTargetQuantity (cross-field consistency)", async () => {
      const service = new OpportunitySettingsService(fakePrisma(), auditStub);
      await expect(
        service.setConfig({ ...VALID_CONFIG, minTargetQuantity: 100, maxTargetQuantity: 50 }, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("rejects a duration window too narrow for the minimum duration (maxDurationDays*24 < minDurationHours)", async () => {
      const service = new OpportunitySettingsService(fakePrisma(), auditStub);
      await expect(
        service.setConfig({ ...VALID_CONFIG, minDurationHours: 100, maxDurationDays: 1 }, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("accepts a valid config at the exact boundary values", async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const service = new OpportunitySettingsService(fakePrisma({ upsert }), auditStub);
      await service.setConfig(
        {
          minDurationHours: 1,
          maxDurationDays: 90,
          minTargetQuantity: 1,
          maxTargetQuantity: 10_000_000,
          showScheduledPubliclyEnabled: true,
        },
        ctx
      );
      expect(upsert).toHaveBeenCalled();
    });
  });

  describe("setConfig — audit", () => {
    it("writes an OPPORTUNITY_SETTINGS_UPDATED audit entry on every successful update", async () => {
      const auditLog = jest.fn().mockResolvedValue(undefined);
      const service = new OpportunitySettingsService(fakePrisma(), { log: auditLog } as never);
      await service.setConfig(VALID_CONFIG, ctx);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "OPPORTUNITY_SETTINGS_UPDATED",
          actorId: "admin-1",
          entityType: "system_setting",
        })
      );
    });
  });

  describe("setConfig — cannot affect any other data (proves settings changes never touch existing Opportunities/Snapshots)", () => {
    it("only ever calls systemSetting.findUnique/upsert — never touches opportunity or snapshot models", async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const findUnique = jest.fn().mockResolvedValue(null);
      const opportunityUpdate = jest.fn();
      const productApprovalSnapshotUpdate = jest.fn();

      const prismaStub = {
        systemSetting: { findUnique, upsert },
        opportunity: { update: opportunityUpdate, updateMany: opportunityUpdate },
        productApprovalSnapshot: { update: productApprovalSnapshotUpdate },
      } as never;

      const service = new OpportunitySettingsService(prismaStub, {
        log: jest.fn().mockResolvedValue(undefined),
      } as never);

      await service.setConfig(VALID_CONFIG, ctx);

      expect(upsert).toHaveBeenCalledTimes(1);
      expect(opportunityUpdate).not.toHaveBeenCalled();
      expect(productApprovalSnapshotUpdate).not.toHaveBeenCalled();
    });
  });
});
