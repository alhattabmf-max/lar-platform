import { TaxProfileService } from "./tax-profile.service";
import { AccountType, CompanyVerificationStatus } from "@prisma/client";

function fakePrisma(overrides: { existingProfile?: unknown } = {}) {
  return {
    company: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: "company-1",
        accountType: AccountType.SUPPLIER,
        verificationStatus: CompanyVerificationStatus.VERIFIED,
      }),
    },
    supplierTaxProfile: {
      findUnique: jest.fn().mockResolvedValue(overrides.existingProfile ?? null),
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: "profile-1", ...create })),
    },
  } as never;
}

const auditStub = { log: jest.fn().mockResolvedValue(undefined) } as never;
const ctx = { userId: "user-1", companyId: "company-1", requestId: "req-1" };

describe("TaxProfileService — VAT consistency", () => {
  it("requires a valid 15-digit vatNumber when isVatRegistered is true", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub);
    await expect(
      service.upsert({ isVatRegistered: true, vatNumber: "123" }, ctx)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("rejects a missing vatNumber when isVatRegistered is true", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub);
    await expect(
      service.upsert({ isVatRegistered: true }, ctx)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("accepts a valid 15-digit vatNumber when isVatRegistered is true", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub);
    const result = await service.upsert({ isVatRegistered: true, vatNumber: "300000000000003" }, ctx);
    expect(result.vatNumber).toBe("300000000000003");
  });

  it("rejects a provided vatNumber when isVatRegistered is false (contradictory state)", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub);
    await expect(
      service.upsert({ isVatRegistered: false, vatNumber: "300000000000003" }, ctx)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("accepts isVatRegistered=false with no vatNumber", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub);
    const result = await service.upsert({ isVatRegistered: false }, ctx);
    expect(result.vatNumber).toBeNull();
  });
});
