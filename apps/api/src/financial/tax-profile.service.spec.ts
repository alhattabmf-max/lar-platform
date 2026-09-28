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

/**
 * The re-verification rule, stubbed.
 *
 * Nothing in this file exercises it: these tests are about the VAT
 * number itself — its shape, and the refusal when it is given while
 * the company says it is not registered. The rule that a VERIFIED
 * supplier changing it must be reviewed again is covered where it
 * lives, against the real service.
 */
const reverifyStub = () =>
  ({ markChangedSinceApproval: jest.fn() }) as never;
const ctx = { userId: "user-1", companyId: "company-1", requestId: "req-1" };

describe("TaxProfileService — VAT consistency", () => {
  it("requires a valid 15-digit vatNumber when isVatRegistered is true", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub, reverifyStub());
    await expect(
      service.upsert({ isVatRegistered: true, vatNumber: "123" }, ctx)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("rejects a missing vatNumber when isVatRegistered is true", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub, reverifyStub());
    await expect(
      service.upsert({ isVatRegistered: true }, ctx)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("accepts a valid 15-digit vatNumber when isVatRegistered is true", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub, reverifyStub());
    const result = await service.upsert({ isVatRegistered: true, vatNumber: "300000000000003" }, ctx);
    expect(result.vatNumber).toBe("300000000000003");
  });

  it("rejects a provided vatNumber when isVatRegistered is false (contradictory state)", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub, reverifyStub());
    await expect(
      service.upsert({ isVatRegistered: false, vatNumber: "300000000000003" }, ctx)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  });

  it("accepts isVatRegistered=false with no vatNumber", async () => {
    const service = new TaxProfileService(fakePrisma(), auditStub, reverifyStub());
    const result = await service.upsert({ isVatRegistered: false }, ctx);
    expect(result.vatNumber).toBeNull();
  });
});
