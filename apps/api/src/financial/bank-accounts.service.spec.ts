import {
  AccountType,
  BankAccountVerificationStatus,
  CompanyVerificationStatus,
} from "@prisma/client";
import { BankAccountsService } from "./bank-accounts.service";

const rawIban = "SA0380000000608010167519";

function bankRow(companyId: string) {
  return {
    id: "bank-1",
    companyId,
    accountHolderName: "Supplier LLC",
    bankName: "Test Bank",
    ibanCiphertext: "v1:encrypted",
    ibanFingerprint: "fingerprint",
    ibanLast4: "7519",
    verificationStatus: BankAccountVerificationStatus.PENDING_VERIFICATION,
    rejectionReason: null,
    verifiedAt: null,
    createdAt: new Date("2026-08-15T00:00:00Z"),
    updatedAt: new Date("2026-08-15T00:00:00Z"),
  };
}

describe("BankAccountsService", () => {
  it("isolates history by company and never returns encrypted or fingerprint data", async () => {
    const prisma = {
      supplierBankAccount: {
        findMany: jest.fn().mockResolvedValue([bankRow("company-a")]),
      },
    };
    const service = new BankAccountsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.listMine("company-a");
    expect(prisma.supplierBankAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: "company-a" } }),
    );
    expect(result[0]).not.toHaveProperty("ibanCiphertext");
    expect(result[0]).not.toHaveProperty("ibanFingerprint");
    expect(result[0]).toHaveProperty("ibanLast4", "7519");
  });

  it("submits encrypted normalized data and never audits or returns the raw IBAN", async () => {
    const prisma = {
      company: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          accountType: AccountType.SUPPLIER,
          verificationStatus: CompanyVerificationStatus.VERIFIED,
        }),
      },
      supplierBankAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(bankRow("company-a")),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const crypto = {
      encrypt: jest.fn().mockReturnValue("v1:encrypted"),
      fingerprintKeyMaterial: "ab".repeat(32),
    };
    const service = new BankAccountsService(
      prisma as never,
      audit as never,
      crypto as never,
    );

    const result = await service.submit(
      {
        accountHolderName: " Supplier LLC ",
        bankName: " Test Bank ",
        iban: "sa03 8000 0000 6080 1016 7519",
      },
      { userId: "user-a", companyId: "company-a", requestId: "request" },
    );

    expect(crypto.encrypt).toHaveBeenCalledWith(rawIban);
    const createData = prisma.supplierBankAccount.create.mock.calls[0][0].data;
    expect(createData.accountHolderName).toBe("Supplier LLC");
    expect(createData.bankName).toBe("Test Bank");
    expect(createData.ibanFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain(rawIban);
    expect(JSON.stringify(result)).not.toContain(rawIban);
  });

  it("blocks a second pending submission before attempting a write", async () => {
    const prisma = {
      company: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          accountType: AccountType.SUPPLIER,
          verificationStatus: CompanyVerificationStatus.VERIFIED,
        }),
      },
      supplierBankAccount: {
        findFirst: jest.fn().mockResolvedValue(bankRow("company-a")),
      },
    };
    const service = new BankAccountsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.submit(
        {
          accountHolderName: "Supplier LLC",
          bankName: "Test Bank",
          iban: rawIban,
        },
        { userId: "user-a", companyId: "company-a", requestId: "request" },
      ),
    ).rejects.toThrow(/already pending/);
  });
});
