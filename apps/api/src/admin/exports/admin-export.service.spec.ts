import ExcelJS from "exceljs";
import {
  AdminExportService,
  disposition,
  safeText,
  EXPORT_ROW_CEILING,
} from "./admin-export.service";
import { ExportLabelsDto } from "./dto/export-labels.dto";

/**
 * The shared export base, on the two dangers a spreadsheet carries.
 *
 * GOING OUT, a value that opens `=` is a formula the reader's Excel
 * runs. COMING BACK, a registration number written as a number has lost
 * its leading zeros and is a different registration. Both are asserted
 * on real workbooks read back by the real library.
 */

describe("AdminExportService", () => {
  let audit: { log: jest.Mock };
  let service: AdminExportService;

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new AdminExportService(audit as never);
  });

  /** Reads a produced workbook back the way Excel would. */
  async function readBack(file: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
    return workbook.worksheets[0];
  }

  describe("what is written", () => {
    it("writes a real .xlsx, not a CSV wearing the extension", async () => {
      const file = await service.build([{ header: "a" }], [["x"]]);

      // Every .xlsx is a ZIP, and this is what proves the writer made
      // one rather than joining strings with commas.
      expect(file.subarray(0, 4)).toEqual(
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      );
    });

    it("keeps a registration's leading zeros by writing it as text", async () => {
      const file = await service.build(
        [{ header: "crNumber" }],
        [["0012345678"]],
      );
      const sheet = await readBack(file);

      const cell = sheet.getRow(2).getCell(1).value;
      expect(cell).toBe("0012345678");
      expect(typeof cell).toBe("string");
    });

    it("keeps a genuine quantity as a number", async () => {
      const file = await service.build([{ header: "users" }], [[42]]);
      const sheet = await readBack(file);

      // A count is arithmetic; a registration is an identifier. The
      // caller's type is what separates them.
      expect(sheet.getRow(2).getCell(1).value).toBe(42);
    });

    it.each(["=cmd|'/c calc'!A", "+1+1", "-1+1", "@SUM(A1)"])(
      "neutralises %s, which Excel would otherwise run",
      async (value) => {
        const file = await service.build([{ header: "legalName" }], [[value]]);
        const sheet = await readBack(file);

        const cell = sheet.getRow(2).getCell(1).value;
        expect(typeof cell).toBe("string");
        expect(String(cell).startsWith("'")).toBe(true);
      },
    );

    it("neutralises a heading too, not only the body", async () => {
      const file = await service.build([{ header: "=EVIL()" }], [["x"]]);
      const sheet = await readBack(file);

      expect(String(sheet.getRow(1).getCell(1).value).startsWith("'")).toBe(
        true,
      );
    });

    it("leaves an ordinary Arabic name alone", () => {
      expect(safeText("شركة حلول المستقبل")).toBe("شركة حلول المستقبل");
    });

    it("writes an empty cell for a missing value, never the word null", async () => {
      const file = await service.build([{ header: "email" }], [[null]]);
      const sheet = await readBack(file);

      const cell = sheet.getRow(2).getCell(1).value;
      expect(cell === "" || cell === null).toBe(true);
    });
  });

  describe("the filename", () => {
    it("carries the Arabic name percent-encoded, with an ASCII fallback", () => {
      const header = disposition("المشترون", "2026-08-25");

      expect(header).toContain("filename=");
      expect(header).toContain("filename*=UTF-8''");
      expect(header).toContain(encodeURIComponent("المشترون-2026-08-25.xlsx"));
      // Raw non-Latin bytes in a header are what proxies mangle.
      expect(header).not.toContain("المشترون-2026");
    });

    it("keeps an English name readable in both halves", () => {
      const header = disposition("suppliers", "2026-08-25");

      expect(header).toContain('filename="suppliers-2026-08-25.xlsx"');
    });

    it("cannot be made to climb a path or end the header", () => {
      const header = disposition('../../etc"; drop', "2026-08-25");

      expect(header).not.toContain("../");
      expect(header).not.toMatch(/filename="[^"]*"[^;]/);
    });
  });

  describe("the audit entry", () => {
    const REQUEST = {
      kind: "companies-traders",
      columns: [{ header: "a" }],
      rows: [["x"], ["y"]],
      fileLabel: "المشترون",
      datePart: "2026-08-25",
      truncated: false,
      filters: {
        search: "نور",
        accountType: "TRADER",
        verificationStatus: null,
      },
      actorId: "admin-1",
      requestId: "req-1",
    };

    /** The three chained calls the service makes, and nothing else. */
    interface FakeResponse {
      type: jest.Mock;
      set: jest.Mock;
      send: jest.Mock;
      headers: Record<string, string>;
    }

    function fakeResponse(): FakeResponse {
      const headers: Record<string, string> = {};
      const res: FakeResponse = {
        type: jest.fn(() => res),
        set: jest.fn((key: string, value: string) => {
          headers[key] = value;
          return res;
        }),
        send: jest.fn(() => res),
        headers,
      };
      return res;
    }

    it("records who exported what, and under which filters", async () => {
      const res = fakeResponse();

      await service.send(res as never, REQUEST);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ADMIN_LIST_EXPORTED",
          actorId: "admin-1",
          after: expect.objectContaining({
            kind: "companies-traders",
            rows: 2,
            truncated: false,
            search: "نور",
            accountType: "TRADER",
          }),
        }),
      );
    });

    it("stores no copy of the file", async () => {
      const res = fakeResponse();

      await service.send(res as never, REQUEST);

      const [entry] = audit.log.mock.calls[0];
      const recorded = JSON.stringify(entry);
      // A trail holding exported spreadsheets is a second copy of
      // everyone's data.
      expect(recorded).not.toContain("PK");
      expect(recorded).not.toContain("base64");
      expect(entry.after.rows).toBe(2);
    });

    it("records the entry BEFORE the bytes go out", async () => {
      const order: string[] = [];
      audit.log.mockImplementation(async () => {
        order.push("audit");
      });
      const res = fakeResponse();
      res.send.mockImplementation(() => {
        order.push("send");
        return res;
      });

      await service.send(res as never, REQUEST);

      // An export that fails mid-transfer is still one that was
      // authorised and attempted.
      expect(order).toEqual(["audit", "send"]);
    });

    it("tells the reader when the file was cut short", async () => {
      const res = fakeResponse();

      await service.send(res as never, { ...REQUEST, truncated: true });

      expect(res.headers["X-Export-Truncated"]).toBe("true");
      expect(audit.log.mock.calls[0][0].after.truncated).toBe(true);
    });

    it("scopes the entry to the company when the export belongs to one", async () => {
      const res = fakeResponse();

      await service.send(res as never, { ...REQUEST, companyId: "company-9" });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "company",
          entityId: "company-9",
        }),
      );
    });
  });

  describe("the safe ceiling", () => {
    it("is a report's worth of rows, not a page and not a table", () => {
      expect(EXPORT_ROW_CEILING).toBeGreaterThan(100);
      expect(EXPORT_ROW_CEILING).toBeLessThanOrEqual(10000);
    });
  });
});

describe("ExportLabelsDto", () => {
  function dto(values: Partial<ExportLabelsDto>): ExportLabelsDto {
    return Object.assign(new ExportLabelsDto(), values);
  }

  it("decodes KEY:label pairs", () => {
    const labels = dto({ statuses: "VERIFIED:موثّق,REJECTED:مرفوض" });

    expect(labels.statusLabel("VERIFIED")).toBe("موثّق");
    expect(labels.statusLabel("REJECTED")).toBe("مرفوض");
  });

  it("returns undefined for a key it was not given, so the caller falls back", () => {
    const labels = dto({ statuses: "VERIFIED:موثّق" });

    // Worse to read than a translation, but never wrong.
    expect(labels.statusLabel("SUSPENDED")).toBeUndefined();
  });

  it("ignores a malformed pair instead of throwing", () => {
    const labels = dto({ roles: "OWNER,:,MANAGER:مدير," });

    expect(labels.roleLabel("MANAGER")).toBe("مدير");
    expect(labels.roleLabel("OWNER")).toBeUndefined();
  });

  it("takes the caller's date when it is a real one", () => {
    expect(dto({ date: "2026-08-25" }).safeDate()).toBe("2026-08-25");
  });

  it.each(["2026-13-45", "2026-02-30", "0000-00-00"])(
    "falls back to the server's day for %s",
    (date) => {
      const result = dto({ date }).safeDate();

      expect(result).not.toBe(date);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    },
  );

  it("falls back when no date was sent at all", () => {
    expect(dto({}).safeDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
