import {
  AccountType,
  BankAccountVerificationStatus,
  CompanyVerificationStatus,
} from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
      {
        assertNotUnderReview: async () => undefined,
        markChangedSinceApproval: async () => undefined,
      } as never,
    );

    const result = await service.listMine("company-a");
    expect(prisma.supplierBankAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: "company-a" } }),
    );
    expect(result[0]).not.toHaveProperty("ibanCiphertext");
    expect(result[0]).not.toHaveProperty("ibanFingerprint");
    expect(result[0]).toHaveProperty("ibanLast4", "7519");
  });

  /**
   * WHO MAY ENTER A PAYOUT ACCOUNT, and when.
   *
   * THE ORDER WAS INVERTED, deliberately. This path used to require an
   * APPROVED supplier, which made the approval a circle: the admin was
   * asked to approve a company whose payout details it could not see,
   * and the supplier was told to wait for an approval that was waiting
   * on them. The account is now one of the things the approval
   * reviews.
   *
   * Neither case below was covered before — the spec only ever built a
   * VERIFIED company — so the old rule and the new one would both have
   * passed it.
   */
  function submitWith(company: {
    accountType: AccountType;
    verificationStatus: CompanyVerificationStatus;
  }) {
    const prisma = {
      company: { findUniqueOrThrow: jest.fn().mockResolvedValue(company) },
      supplierBankAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(bankRow("company-a")),
      },
    };
    const service = new BankAccountsService(
      prisma as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      {
        encrypt: jest.fn().mockReturnValue("v1:encrypted"),
        fingerprintKeyMaterial: "ab".repeat(32),
      } as never,
      {
        assertNotUnderReview: async () => undefined,
        markChangedSinceApproval: async () => undefined,
      } as never,
    );

    return {
      prisma,
      run: () =>
        service.submit(
          {
            accountHolderName: "Supplier LLC",
            bankName: "Test Bank",
            iban: rawIban,
          } as never,
          {
            companyId: "company-a",
            userId: "user-1",
            requestId: "req-1",
          } as never,
        ),
    };
  }

  it("lets a supplier enter its account BEFORE it is approved", async () => {
    const { prisma, run } = submitWith({
      accountType: AccountType.SUPPLIER,
      verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
    });

    await expect(run()).resolves.toBeDefined();
    expect(prisma.supplierBankAccount.create).toHaveBeenCalled();
  });

  it("still refuses a BUYER, because nothing is ever paid out to one", async () => {
    const { prisma, run } = submitWith({
      accountType: AccountType.TRADER,
      verificationStatus: CompanyVerificationStatus.VERIFIED,
    });

    await expect(run()).rejects.toThrow();
    expect(prisma.supplierBankAccount.create).not.toHaveBeenCalled();
  });

  /**
   * IT USED TO SAY "which did NOT change", and pinned invoicing and tax
   * behind approval while only the bank account had moved. Both have
   * since moved for the same stated reason: they are part of the record
   * an administrator reviews, and requiring approval first made the
   * review incomplete and the supplier wait for an approval that was
   * waiting for them.
   *
   * What the case still guards is the half that did NOT change — a
   * buyer is refused all three, because only a supplier is paid and
   * only a supplier's commission document is addressed to anybody.
   */
  it("keeps all three refused to a BUYER, which did NOT change", () => {
    const invoicing = readFileSync(
      join(__dirname, "invoicing-profile.service.ts"),
      "utf8",
    );
    const tax = readFileSync(join(__dirname, "tax-profile.service.ts"), "utf8");

    expect(invoicing).toContain("requireSupplierCompany");
    expect(tax).toContain("requireSupplierCompany");
    expect(
      readFileSync(join(__dirname, "require-verified-supplier.ts"), "utf8"),
    ).toContain("Only supplier accounts have financial readiness data");
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
      {
        assertNotUnderReview: async () => undefined,
        markChangedSinceApproval: async () => undefined,
      } as never,
    );

    const result = await service.submit(
      {
        accountHolderName: " Supplier LLC ",
        iban: "sa03 8000 0000 6080 1016 7519",
      },
      { userId: "user-a", companyId: "company-a", requestId: "request" },
    );

    expect(crypto.encrypt).toHaveBeenCalledWith(rawIban);
    const createData = prisma.supplierBankAccount.create.mock.calls[0][0].data;
    expect(createData.accountHolderName).toBe("Supplier LLC");
    // THE BANK IS READ OUT OF THE NUMBER. Bank code 80 is Al Rajhi;
    // nothing in the request said so, and nothing in the request could
    // have said otherwise.
    expect(createData.bankName).toBe("مصرف الراجحي");
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
      {
        assertNotUnderReview: async () => undefined,
        markChangedSinceApproval: async () => undefined,
      } as never,
    );
    await expect(
      service.submit(
        { accountHolderName: "Supplier LLC", iban: rawIban },
        { userId: "user-a", companyId: "company-a", requestId: "request" },
      ),
    ).rejects.toThrow(/already pending/);
  });

  /**
   * AN UNRECOGNISED BANK CODE MUST NOT STOP A PAYOUT ACCOUNT.
   *
   * The code table is reference data about the world and can lag a new
   * entrant. If an unknown code were refused, a supplier banking with
   * whoever opened last week could not be paid until this repository
   * shipped — so the number is stored, and the row says plainly that
   * nobody identified the bank.
   */
  it("stores a checksum-valid IBAN whose bank code is not in the table", async () => {
    const unknownCodeIban = "SA5499000000000000000000";
    const prisma = {
      company: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          accountType: AccountType.SUPPLIER,
          verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
        }),
      },
      supplierBankAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          ...bankRow("company-a"),
          bankName: "بنك غير معروف",
          ibanLast4: "0000",
        }),
      },
    };
    const crypto = {
      encrypt: jest.fn().mockReturnValue("v1:encrypted"),
      fingerprintKeyMaterial: "00".repeat(32),
    };
    const service = new BankAccountsService(
      prisma as never,
      { log: jest.fn() } as never,
      crypto as never,
      {
        assertNotUnderReview: async () => undefined,
        markChangedSinceApproval: async () => undefined,
      } as never,
    );

    await service.submit(
      { accountHolderName: "Supplier LLC", iban: unknownCodeIban },
      { userId: "user-a", companyId: "company-a", requestId: "request" },
    );

    const createData = prisma.supplierBankAccount.create.mock.calls[0][0].data;
    expect(createData.bankName).toBe("بنك غير معروف");
    expect(createData.ibanLast4).toBe("0000");
  });

  it("refuses an IBAN whose checksum does not agree", async () => {
    const prisma = {
      company: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          accountType: AccountType.SUPPLIER,
          verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
        }),
      },
      supplierBankAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const service = new BankAccountsService(
      prisma as never,
      { log: jest.fn() } as never,
      { encrypt: jest.fn(), fingerprintKeyMaterial: "00".repeat(32) } as never,
      {
        assertNotUnderReview: async () => undefined,
        markChangedSinceApproval: async () => undefined,
      } as never,
    );

    await expect(
      service.submit(
        // One digit of the valid fixture changed.
        { accountHolderName: "Supplier LLC", iban: "SA0380000000608010167518" },
        { userId: "user-a", companyId: "company-a", requestId: "request" },
      ),
    ).rejects.toThrow(/Invalid Saudi IBAN/);
    expect(prisma.supplierBankAccount.create).not.toHaveBeenCalled();
  });
});
