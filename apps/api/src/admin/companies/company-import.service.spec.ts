import ExcelJS from "exceljs";
import { AccountType } from "@prisma/client";
import { NotFoundException } from "@nestjs/common";
import { CompanyImportService } from "./company-import.service";
import {
  CompanyWorkbookService,
  IMPORT_COLUMNS,
} from "./company-workbook.service";
import { BusinessException } from "../../common/errors/business-exception";

/**
 * What an import does, and — more importantly — what it refuses to do.
 *
 * THE PREVIEW WRITES NOTHING. That is asserted directly rather than
 * inferred: a preview that created a company would be discovered by an
 * operator, in production, after they had cancelled.
 *
 * THE COMMIT RE-CHECKS EVERYTHING. A preview is a photograph of a
 * moment; the transaction is where the decision is actually made. The
 * test that matters here is the one where a registration is taken
 * BETWEEN the two steps.
 *
 * NO PASSWORD IS EVER WRITTEN. Every created user is asserted to have a
 * null hash — not a default, not a random one nobody knows.
 */

const CTX = {
  actorId: "admin-1",
  requestId: "req-1",
  ipAddress: "127.0.0.1",
  userAgent: "jest",
};

function row(overrides: Partial<Record<string, string>> = {}) {
  const base: Record<string, string> = {
    crNumber: "1010101010",
    legalName: "شركة الاختبار",
    accountType: "TRADER",
    ownerEmail: "owner@example.com",
    primaryMobile1: "0500000000",
    primaryMobile2: "0500000001",
    ...overrides,
  };
  return IMPORT_COLUMNS.map((column) => base[column.key] ?? "");
}

async function fileOf(rows: string[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("companies");
  sheet.addRow(IMPORT_COLUMNS.map((column) => column.key));
  for (const entry of rows) sheet.addRow(entry);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("CompanyImportService", () => {
  let prisma: {
    company: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    user: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { log: jest.Mock };
  let auth: { forgotPassword: jest.Mock };
  let store: Map<string, string>;
  let redis: {
    getClient: () => { set: jest.Mock; get: jest.Mock; del: jest.Mock };
  };
  let service: CompanyImportService;

  beforeEach(() => {
    prisma = {
      company: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "company-1" }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "user-1" }),
      },
      // The real client hands the callback a transaction client; the
      // same mock stands in for it, so a write made on `tx` is visible
      // to these assertions.
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    auth = { forgotPassword: jest.fn().mockResolvedValue(undefined) };

    store = new Map();
    redis = {
      getClient: () => ({
        set: jest.fn(async (key: string, value: string) => {
          store.set(key, value);
          return "OK";
        }),
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      }),
    };

    service = new CompanyImportService(
      prisma as never,
      audit as never,
      auth as never,
      redis as never,
      new CompanyWorkbookService(),
    );
  });

  describe("the preview", () => {
    it("writes nothing at all", async () => {
      await service.preview(
        await fileOf([row()]),
        "companies.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(prisma.company.create).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(auth.forgotPassword).not.toHaveBeenCalled();
    });

    it("counts what would happen", async () => {
      const file = await fileOf([
        row(),
        row({ crNumber: "2020202020", ownerEmail: "b@example.com" }),
        row({ crNumber: "bad", ownerEmail: "c@example.com" }),
      ]);

      const preview = await service.preview(
        file,
        "companies.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(preview.total).toBe(3);
      expect(preview.valid).toBe(2);
      expect(preview.rejected).toBe(1);
    });

    it.each([
      ["a missing registration number", { crNumber: "" }, "MISSING_CRNUMBER"],
      [
        "a nine-digit registration",
        { crNumber: "101010101" },
        "INVALID_CR_FORMAT",
      ],
      [
        "a registration with letters",
        { crNumber: "10101010AB" },
        "INVALID_CR_FORMAT",
      ],
      ["a missing name", { legalName: "" }, "MISSING_LEGALNAME"],
      [
        "an address with no @",
        { ownerEmail: "owner.example.com" },
        "INVALID_EMAIL",
      ],
      [
        "an account type that is neither",
        { accountType: "ADMIN" },
        "INVALID_ACCOUNT_TYPE",
      ],
      [
        "a mobile that is a word",
        { primaryMobile1: "call me" },
        "INVALID_PRIMARYMOBILE1",
      ],
      [
        "a second mobile left blank",
        { primaryMobile2: "" },
        "MISSING_PRIMARYMOBILE2",
      ],
    ])("rejects %s and says why", async (_label, overrides, reason) => {
      const preview = await service.preview(
        await fileOf([row(overrides)]),
        "f.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(preview.errors).toHaveLength(1);
      expect(preview.errors[0].reason).toBe(reason);
      // The row number IN THE FILE, so the operator can go and fix it.
      expect(preview.errors[0].rowNumber).toBe(2);
    });

    it("accepts an account type in lower case", async () => {
      const preview = await service.preview(
        await fileOf([row({ accountType: "supplier" })]),
        "f.xlsx",
        CTX,
        AccountType.SUPPLIER,
      );

      expect(preview.valid).toBe(1);
    });

    it("refuses a row naming the OTHER register", async () => {
      // The point of scoping an import to the tab it started from: a
      // supplier row uploaded on the buyers tab is a mistake, and
      // importing it quietly would put it where nobody will look.
      const preview = await service.preview(
        await fileOf([row({ accountType: "SUPPLIER" })]),
        "f.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(preview.valid).toBe(0);
      expect(preview.errors[0].reason).toBe("ACCOUNT_TYPE_MISMATCH");
    });

    it("takes the tab's kind when the column is left blank", async () => {
      const preview = await service.preview(
        await fileOf([row({ accountType: "" })]),
        "f.xlsx",
        CTX,
        AccountType.SUPPLIER,
      );

      expect(preview.valid).toBe(1);
    });

    it("rejects the SECOND row claiming a registration, not the first", async () => {
      const file = await fileOf([
        row(),
        row({ ownerEmail: "second@example.com" }),
      ]);

      const preview = await service.preview(
        file,
        "f.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(preview.valid).toBe(1);
      expect(preview.errors).toEqual([
        expect.objectContaining({
          rowNumber: 3,
          reason: "DUPLICATE_CR_IN_FILE",
        }),
      ]);
    });

    it("rejects a repeated owner address inside the file", async () => {
      const file = await fileOf([row(), row({ crNumber: "2020202020" })]);

      const preview = await service.preview(
        file,
        "f.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(preview.errors).toEqual([
        expect.objectContaining({
          rowNumber: 3,
          reason: "DUPLICATE_EMAIL_IN_FILE",
        }),
      ]);
      expect(preview.duplicates).toBe(1);
    });

    it("rejects a registration the platform already holds", async () => {
      prisma.company.findMany.mockResolvedValue([{ crNumber: "1010101010" }]);

      const preview = await service.preview(
        await fileOf([row()]),
        "f.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(preview.valid).toBe(0);
      expect(preview.errors[0].reason).toBe("CR_ALREADY_REGISTERED");
    });

    it("rejects an address the platform already holds, whatever its case", async () => {
      prisma.user.findMany.mockResolvedValue([{ email: "OWNER@EXAMPLE.COM" }]);

      const preview = await service.preview(
        await fileOf([row()]),
        "f.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(preview.valid).toBe(0);
      expect(preview.errors[0].reason).toBe("EMAIL_ALREADY_REGISTERED");
    });

    it("stores the fingerprint of the file, never the file", async () => {
      const file = await fileOf([row()]);

      await service.preview(file, "companies.xlsx", CTX, AccountType.TRADER);

      const staged = JSON.parse([...store.values()][0]);
      expect(staged.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      // A staged upload would be a second copy of everyone's data,
      // sitting in a cache.
      expect(JSON.stringify(staged)).not.toContain(
        file.toString("base64").slice(0, 40),
      );
    });

    it("records that a file was read, and by whom", async () => {
      await service.preview(
        await fileOf([row()]),
        "companies.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "COMPANY_IMPORT_PREVIEWED",
          actorId: "admin-1",
          after: expect.objectContaining({
            fileName: "companies.xlsx",
            total: 1,
            valid: 1,
          }),
        }),
      );
    });

    it("sorts the rejected rows by row number", async () => {
      const file = await fileOf([
        row({ crNumber: "bad1" }),
        row({ crNumber: "2020202020", ownerEmail: "b@example.com" }),
        row({ crNumber: "bad3", ownerEmail: "c@example.com" }),
      ]);

      const preview = await service.preview(
        file,
        "f.xlsx",
        CTX,
        AccountType.TRADER,
      );

      expect(preview.errors.map((error) => error.rowNumber)).toEqual([2, 4]);
    });
  });

  describe("the commit", () => {
    async function stage(rows: string[][]) {
      const preview = await service.preview(
        await fileOf(rows),
        "companies.xlsx",
        CTX,
        AccountType.TRADER,
      );
      return preview.importId;
    }

    it("creates the company and its owner", async () => {
      const importId = await stage([row()]);

      const result = await service.commit(importId, CTX);

      expect(result.created).toBe(1);
      expect(prisma.company.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            crNumber: "1010101010",
            accountType: "TRADER",
          }),
        }),
      );
    });

    it("creates the owner with NO password", async () => {
      const importId = await stage([row()]);

      await service.commit(importId, CTX);

      const data = prisma.user.create.mock.calls[0][0].data;
      // Null, not a hash of anything. A default credential is one
      // somebody other than the owner knows.
      expect(data.passwordHash).toBeNull();
      expect(Object.keys(data)).not.toContain("password");
    });

    it("does not set the company verified", async () => {
      const importId = await stage([row()]);

      await service.commit(importId, CTX);

      const data = prisma.company.create.mock.calls[0][0].data;
      expect(data.verificationStatus).toBeUndefined();
    });

    it("invites the owner through the ordinary reset flow", async () => {
      const importId = await stage([row()]);

      const result = await service.commit(importId, CTX);

      expect(auth.forgotPassword).toHaveBeenCalledWith(
        "owner@example.com",
        expect.anything(),
      );
      expect(result.invited).toBe(1);
    });

    it("sends the invitations only AFTER the transaction closes", async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const value = await fn(prisma);
          order.push("commit");
          return value;
        },
      );
      auth.forgotPassword.mockImplementation(async () => {
        order.push("invite");
      });

      await service.commit(await stage([row()]), CTX);

      // A link to an account whose transaction then rolled back is a
      // link into nothing.
      expect(order).toEqual(["commit", "invite"]);
    });

    it("keeps the import when the mail provider fails", async () => {
      auth.forgotPassword.mockRejectedValue(new Error("smtp down"));

      const result = await service.commit(await stage([row()]), CTX);

      expect(result.created).toBe(1);
      expect(result.invited).toBe(0);
    });

    it("skips a registration taken BETWEEN the preview and the commit", async () => {
      const importId = await stage([row()]);
      // The window this whole two-step shape exists to survive.
      prisma.company.findUnique.mockResolvedValue({ id: "someone-else" });

      const result = await service.commit(importId, CTX);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors[0].reason).toBe("CR_ALREADY_REGISTERED");
      expect(prisma.company.create).not.toHaveBeenCalled();
    });

    it("skips an address taken between the two steps", async () => {
      const importId = await stage([row()]);
      prisma.user.findUnique.mockResolvedValue({ id: "someone-else" });

      const result = await service.commit(importId, CTX);

      expect(result.skipped).toBe(1);
      expect(result.errors[0].reason).toBe("EMAIL_ALREADY_REGISTERED");
    });

    it("imports the good rows and reports the rest rather than failing wholesale", async () => {
      const importId = await stage([
        row(),
        row({ crNumber: "2020202020", ownerEmail: "b@example.com" }),
      ]);
      prisma.company.findUnique.mockImplementation(async ({ where }: never) =>
        (where as { crNumber: string }).crNumber === "2020202020"
          ? { id: "taken" }
          : null,
      );

      const result = await service.commit(importId, CTX);

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
      // Which one, and why — not "1 row failed".
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          rowNumber: 3,
          reason: "CR_ALREADY_REGISTERED",
        }),
      );
    });

    it("cannot be committed twice", async () => {
      const importId = await stage([row()]);

      await service.commit(importId, CTX);

      await expect(service.commit(importId, CTX)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.company.create).toHaveBeenCalledTimes(1);
    });

    it("refuses an import staged by a different administrator", async () => {
      const importId = await stage([row()]);

      await expect(
        service.commit(importId, { ...CTX, actorId: "admin-2" }),
      ).rejects.toBeInstanceOf(BusinessException);
      expect(prisma.company.create).not.toHaveBeenCalled();
    });

    it("refuses an import that has expired", async () => {
      await expect(
        service.commit("11111111-1111-1111-1111-111111111111", CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("records the commit inside the transaction", async () => {
      await service.commit(await stage([row()]), CTX);

      // Two arguments: the entry and the transaction client. An audit
      // written outside would survive a rollback of what it describes.
      const call = audit.log.mock.calls.find(
        ([entry]) => entry.action === "COMPANY_IMPORT_COMMITTED",
      );
      expect(call).toBeDefined();
      expect(call![1]).toBe(prisma);
    });

    it("records no personal data beyond the counts", async () => {
      await service.commit(await stage([row()]), CTX);

      const [entry] = audit.log.mock.calls.find(
        ([candidate]) => candidate.action === "COMPANY_IMPORT_COMMITTED",
      )!;
      expect(JSON.stringify(entry.after)).not.toContain("owner@example.com");
      expect(JSON.stringify(entry.after)).not.toContain("0500000000");
    });
  });
});
