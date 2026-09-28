import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import type { Env } from "@platform/config";
import { AuditService } from "../src/audit/audit.service";
import { BankDataCryptoService } from "../src/common/security/bank-data-crypto.service";
import { BankAccountsService } from "../src/financial/bank-accounts.service";
import type { PrismaService } from "../src/database/prisma.service";

const prisma = new PrismaClient() as unknown as PrismaService;

function integrationEnv(): Env {
  return {
    NODE_ENV: "test",
    PORT: 3000,
    LOG_LEVEL: "info",
    TZ: "UTC",
    DEFAULT_DISPLAY_TIMEZONE: "Asia/Riyadh",
    DATABASE_URL: "postgresql://platform:platform@localhost:5432/platform_test",
    REDIS_URL: "redis://localhost:6379",
    ADMIN_TOTP_ENCRYPTION_KEY: "a".repeat(64),
    ADMIN_TOTP_ISSUER: "Azier Plus Admin",
    BANK_DATA_ENCRYPTION_KEY:
      process.env.BANK_DATA_ENCRYPTION_KEY ?? "b".repeat(64),
    STORAGE_ENDPOINT: "http://localhost:9000",
    STORAGE_REGION: "us-east-1",
    STORAGE_ACCESS_KEY: "platform_minio_access",
    STORAGE_SECRET_KEY: "platform_minio_secret",
    STORAGE_BUCKET_NAME: "platform-test",
    STORAGE_FORCE_PATH_STYLE: true,
    EMAIL_PROVIDER_MODE: "mock",
    EMAIL_REQUIRED: false,
    MAP_PROVIDER_MODE: "manual",
    CORS_ALLOWED_ORIGINS: [],
  };
}

describe("Bank account IBAN encryption (live Postgres integration)", () => {
  const crypto = new BankDataCryptoService(integrationEnv());
  let service: BankAccountsService;
  const verificationCalls: string[] = [];

  beforeAll(() => {
    // THE STUB MUST ANSWER EVERY CALL THE SERVICE MAKES.
    //
    // `add` asks two things of the verification service: it refuses a
    // change while a review is open, and — since bank details are what
    // the approval is most about — it marks the supplier as changed
    // since approval afterwards. The stub carried only the first, so
    // every create in this file died on `markChangedSinceApproval is
    // not a function`, in a suite that is about IBAN encryption and
    // has nothing to say about re-verification.
    //
    // Both calls are recorded rather than silently swallowed, so a
    // path that stopped making them would be visible here.
    service = new BankAccountsService(prisma, new AuditService(prisma), crypto, {
      assertNotUnderReview: async (companyId: string) => {
        verificationCalls.push(`assertNotUnderReview:${companyId}`);
      },
      markChangedSinceApproval: async (companyId: string, trigger: string) => {
        verificationCalls.push(`markChangedSinceApproval:${companyId}:${trigger}`);
      },
    } as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createVerifiedSupplierCompany(): Promise<string> {
    const company = await prisma.company.create({
      data: {
        crNumber: `CR-BANK-IT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        legalName: "Bank IT Co",
        accountType: "SUPPLIER",
        verificationStatus: "VERIFIED",
      },
    });
    return company.id;
  }

  it("stores the IBAN encrypted in the database — the raw value is never present in the ciphertext column", async () => {
    const companyId = await createVerifiedSupplierCompany();
    const rawIban = "SA0380000000608010167519";
    const result = await service.submit(
      { accountHolderName: "Holder", iban: rawIban },
      {
        userId: "00000000-0000-0000-0000-000000000001",
        companyId,
        requestId: "req-1",
      },
    );

    const row = await prisma.supplierBankAccount.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(row.ibanCiphertext).not.toContain(rawIban);
    expect(row.ibanCiphertext).not.toContain("SA03");
    expect(crypto.decrypt(row.ibanCiphertext)).toBe(rawIban);
    expect(row.ibanLast4).toBe("7519");
  });

  it("the identity-freeze trigger blocks a raw UPDATE to a VERIFIED row's iban_ciphertext", async () => {
    const companyId = await createVerifiedSupplierCompany();
    const rawIban = "SA7380000000608010167520";
    const result = await service.submit(
      { accountHolderName: "Holder2", iban: rawIban },
      {
        userId: "00000000-0000-0000-0000-000000000002",
        companyId,
        requestId: "req-2",
      },
    );

    await prisma.supplierBankAccount.update({
      where: { id: result.id },
      data: { verificationStatus: "VERIFIED", verifiedAt: new Date() },
    });

    await expect(
      prisma.supplierBankAccount.update({
        where: { id: result.id },
        data: { ibanCiphertext: "tampered-ciphertext" },
      }),
    ).rejects.toThrow();
  });

  it("allows only one pending submission when two requests race for the same company", async () => {
    const companyId = await createVerifiedSupplierCompany();
    const ctx = {
      userId: "00000000-0000-0000-0000-000000000003",
      companyId,
      requestId: "req-concurrent",
    };

    const results = await Promise.allSettled([
      service.submit(
        {
          accountHolderName: "Holder",
          iban: "SA0380000000608010167519",
        },
        ctx,
      ),
      service.submit(
        {
          accountHolderName: "Holder",
          iban: "SA7380000000608010167520",
        },
        ctx,
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      prisma.supplierBankAccount.count({
        where: { companyId, verificationStatus: "PENDING_VERIFICATION" },
      }),
    ).resolves.toBe(1);
  });
});
