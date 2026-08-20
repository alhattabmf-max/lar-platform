import { FinancialReadinessService } from "./financial-readiness.service";
import { BankAccountVerificationStatus } from "@prisma/client";

function fakePrisma(company: Record<string, unknown>) {
  return {
    company: { findUniqueOrThrow: jest.fn().mockResolvedValue(company) },
  } as never;
}

describe("FinancialReadinessService", () => {
  it("is ready when bank account VERIFIED, tax profile and invoicing profile both exist", async () => {
    const service = new FinancialReadinessService(
      fakePrisma({
        activeBankAccount: { verificationStatus: BankAccountVerificationStatus.VERIFIED },
        taxProfile: { id: "t1" },
        invoicingProfile: { id: "i1" },
      })
    );
    const result = await service.check("company-1");
    expect(result.isReady).toBe(true);
  });

  it("is NOT ready when the bank account is still PENDING_VERIFICATION", async () => {
    const service = new FinancialReadinessService(
      fakePrisma({
        activeBankAccount: { verificationStatus: BankAccountVerificationStatus.PENDING_VERIFICATION },
        taxProfile: { id: "t1" },
        invoicingProfile: { id: "i1" },
      })
    );
    const result = await service.check("company-1");
    expect(result.isReady).toBe(false);
    expect(result.hasVerifiedBankAccount).toBe(false);
  });

  it("is NOT ready when there is no active bank account at all", async () => {
    const service = new FinancialReadinessService(
      fakePrisma({ activeBankAccount: null, taxProfile: { id: "t1" }, invoicingProfile: { id: "i1" } })
    );
    const result = await service.check("company-1");
    expect(result.isReady).toBe(false);
  });

  it("is NOT ready when tax profile is missing", async () => {
    const service = new FinancialReadinessService(
      fakePrisma({
        activeBankAccount: { verificationStatus: BankAccountVerificationStatus.VERIFIED },
        taxProfile: null,
        invoicingProfile: { id: "i1" },
      })
    );
    const result = await service.check("company-1");
    expect(result.isReady).toBe(false);
    expect(result.hasTaxProfile).toBe(false);
  });

  it("remains ready even while payout_hold_until is set in the future — readiness is independent of the hold", async () => {
    const futureHold = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10); // 10 days out
    const service = new FinancialReadinessService(
      fakePrisma({
        activeBankAccount: { verificationStatus: BankAccountVerificationStatus.VERIFIED },
        taxProfile: { id: "t1" },
        invoicingProfile: { id: "i1" },
        payoutHoldUntil: futureHold,
      })
    );
    const result = await service.check("company-1");
    expect(result.isReady).toBe(true);
  });
});
