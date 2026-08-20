import { BankAccountVerificationStatus } from "@prisma/client";
import { AdminBankAccountsService } from "./admin-bank-accounts.service";

describe("AdminBankAccountsService", () => {
  it("returns a strict review projection without ciphertext or fingerprint", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new AdminBankAccountsService(
      { supplierBankAccount: { findMany } } as never,
      {} as never,
      {} as never,
    );

    await service.listPendingReview();
    const query = findMany.mock.calls[0][0];
    expect(query.select.ibanCiphertext).toBeUndefined();
    expect(query.select.ibanFingerprint).toBeUndefined();
    expect(query.select.ibanLast4).toBe(true);
  });

  it("claims approval once, supersedes history, and switches the pointer atomically", async () => {
    const pending = {
      id: "new-bank",
      companyId: "company-a",
      verificationStatus: BankAccountVerificationStatus.PENDING_VERIFICATION,
    };
    const tx = {
      company: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ activeBankAccountId: "old-bank" }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      supplierBankAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      supplierBankAccount: { findUnique: jest.fn().mockResolvedValue(pending) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
      ),
    };
    const service = new AdminBankAccountsService(
      prisma as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      { getPayoutHoldDays: jest.fn().mockResolvedValue(3) } as never,
    );

    await service.approve("new-bank", "admin-a", { requestId: "request" });

    expect(tx.supplierBankAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "new-bank",
          verificationStatus:
            BankAccountVerificationStatus.PENDING_VERIFICATION,
        }),
        data: expect.objectContaining({
          verificationStatus: BankAccountVerificationStatus.VERIFIED,
        }),
      }),
    );
    expect(tx.supplierBankAccount.update).toHaveBeenCalledWith({
      where: { id: "old-bank" },
      data: { verificationStatus: BankAccountVerificationStatus.SUPERSEDED },
    });
    expect(tx.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activeBankAccountId: "new-bank" }),
      }),
    );
  });

  it("rejects a concurrent duplicate approval after the atomic claim loses", async () => {
    const tx = {
      supplierBankAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      supplierBankAccount: {
        findUnique: jest.fn().mockResolvedValue({
          id: "bank",
          companyId: "company",
          verificationStatus:
            BankAccountVerificationStatus.PENDING_VERIFICATION,
        }),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
      ),
    };
    const service = new AdminBankAccountsService(
      prisma as never,
      {} as never,
      { getPayoutHoldDays: jest.fn().mockResolvedValue(3) } as never,
    );

    await expect(
      service.approve("bank", "admin", { requestId: "request" }),
    ).rejects.toThrow(/already completed/);
  });
});
