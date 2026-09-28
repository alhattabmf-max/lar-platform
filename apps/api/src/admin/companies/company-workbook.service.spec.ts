import ExcelJS from "exceljs";
import {
  CompanyWorkbookService,
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
} from "./company-workbook.service";
import { BusinessException } from "../../common/errors/business-exception";

/**
 * What a spreadsheet is allowed to be, on the way in and on the way out.
 *
 * The two dangers a workbook carries are opposite ones. Going OUT, a
 * value that starts with `=` becomes a formula that runs on the reader's
 * machine. Coming IN, a file that is not a workbook at all reaches a
 * parser that was never meant to see it. Both are asserted here on real
 * files, written and read by the real library — a mocked workbook would
 * prove only that the mock behaves.
 */

const HEADERS = Object.fromEntries(
  IMPORT_COLUMNS.map((column) => [column.key, column.key]),
) as Record<(typeof IMPORT_COLUMNS)[number]["key"], string>;

/** A real .xlsx, built the way an operator's would be. */
async function workbookOf(
  rows: string[][],
  headers: string[] = IMPORT_COLUMNS.map((c) => c.key),
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("companies");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const GOOD_ROW = [
  "1010101010",
  "شركة الاختبار",
  "TRADER",
  "owner@example.com",
  "0500000000",
  "0500000001",
];

describe("CompanyWorkbookService", () => {
  const service = new CompanyWorkbookService();

  describe("what may be uploaded", () => {
    it("refuses an empty file", async () => {
      await expect(service.parseUpload(Buffer.alloc(0))).rejects.toBeInstanceOf(
        BusinessException,
      );
    });

    it("refuses a file over the size ceiling before parsing it", async () => {
      // Filled with the .xlsx signature so it is the SIZE that stops it,
      // not the shape — otherwise this would pass for the wrong reason.
      const big = Buffer.alloc(IMPORT_LIMITS.maxBytes + 1);
      IMPORT_LIMITS.signature.copy(big, 0);

      await expect(service.parseUpload(big)).rejects.toThrow(/larger than/);
    });

    it("refuses a CSV renamed .xlsx", async () => {
      const csv = Buffer.from("crNumber,legalName\n1010101010,Test\n", "utf8");

      await expect(service.parseUpload(csv)).rejects.toThrow(
        /not a real \.xlsx/,
      );
    });

    it("refuses an HTML page renamed .xlsx", async () => {
      const html = Buffer.from(
        "<html><body>not a workbook</body></html>",
        "utf8",
      );

      await expect(service.parseUpload(html)).rejects.toThrow(
        /not a real \.xlsx/,
      );
    });

    it("refuses a zip that is not a workbook", async () => {
      // Passes the signature check and fails inside the loader, which is
      // the case the signature check alone cannot catch.
      const zip = Buffer.concat([IMPORT_LIMITS.signature, Buffer.alloc(200)]);

      await expect(service.parseUpload(zip)).rejects.toThrow(
        /could not be read/,
      );
    });

    it("names every missing column rather than saying the file is wrong", async () => {
      const file = await workbookOf(
        [["1010101010", "Test"]],
        ["crNumber", "legalName"],
      );

      await expect(service.parseUpload(file)).rejects.toThrow(
        /accountType.*ownerEmail.*primaryMobile1.*primaryMobile2/,
      );
    });

    it("refuses a file over the row ceiling", async () => {
      const rows = Array.from(
        { length: IMPORT_LIMITS.maxRows + 1 },
        (_, index) => [
          String(1010101010 + index),
          "Test",
          "TRADER",
          `owner${index}@example.com`,
          "0500000000",
          "0500000001",
        ],
      );

      await expect(service.parseUpload(await workbookOf(rows))).rejects.toThrow(
        /row limit/,
      );
    });
  });

  describe("what is read out of a valid file", () => {
    it("keeps the row number from the file so an operator can find it", async () => {
      const parsed = await service.parseUpload(
        await workbookOf([GOOD_ROW, GOOD_ROW]),
      );

      // Row 1 is the header: the first record is row 2 IN THE FILE, not
      // record 0.
      expect(parsed.map((row) => row.rowNumber)).toEqual([2, 3]);
    });

    it("reads columns by their key, not their position", async () => {
      const reordered = await workbookOf(
        [
          [
            "TRADER",
            "owner@example.com",
            "1010101010",
            "الاسم",
            "0500000000",
            "0500000001",
          ],
        ],
        [
          "accountType",
          "ownerEmail",
          "crNumber",
          "legalName",
          "primaryMobile1",
          "primaryMobile2",
        ],
      );

      const parsed = await service.parseUpload(reordered);

      expect(parsed[0].values.crNumber).toBe("1010101010");
      expect(parsed[0].values.legalName).toBe("الاسم");
      expect(parsed[0].values.accountType).toBe("TRADER");
    });

    it("skips the blank trailing rows every spreadsheet ends with", async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("companies");
      sheet.addRow(IMPORT_COLUMNS.map((column) => column.key));
      sheet.addRow(GOOD_ROW);
      sheet.addRow([]);
      sheet.addRow(["", "", "", "", "", ""]);
      const file = Buffer.from(await workbook.xlsx.writeBuffer());

      const parsed = await service.parseUpload(file);

      // One record, not three rejected ones.
      expect(parsed).toHaveLength(1);
    });

    it("takes a formula's cached result and never the formula", async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("companies");
      sheet.addRow(IMPORT_COLUMNS.map((column) => column.key));
      const row = sheet.addRow(GOOD_ROW);
      row.getCell(2).value = {
        formula: 'HYPERLINK("http://evil","name")',
        result: "name",
      };
      const file = Buffer.from(await workbook.xlsx.writeBuffer());

      const parsed = await service.parseUpload(file);

      expect(parsed[0].values.legalName).toBe("name");
      expect(parsed[0].values.legalName).not.toContain("HYPERLINK");
    });

    it("reads rich text as its characters", async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("companies");
      sheet.addRow(IMPORT_COLUMNS.map((column) => column.key));
      const row = sheet.addRow(GOOD_ROW);
      row.getCell(2).value = {
        richText: [
          { text: "شركة " },
          { text: "الاختبار", font: { bold: true } },
        ],
      };
      const file = Buffer.from(await workbook.xlsx.writeBuffer());

      const parsed = await service.parseUpload(file);

      expect(parsed[0].values.legalName).toBe("شركة الاختبار");
    });
  });

  describe("what is written into a file", () => {
    it("neutralises a value Excel would run as a formula", async () => {
      const file = await service.buildExport(
        ["legalName"],
        [['=HYPERLINK("http://evil","click")']],
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
      const cell = workbook.worksheets[0].getRow(2).getCell(1);

      // Stored as TEXT. If this were a formula record, `value` would be
      // an object carrying `formula` — and Excel would run it.
      expect(typeof cell.value).toBe("string");
      expect(String(cell.value).startsWith("'")).toBe(true);
    });

    it.each(["=cmd", "+1+1", "-1+1", "@SUM(A1)"])(
      "neutralises %s, which Excel treats as a formula",
      (value) => {
        expect(service.safeText(value)).toBe(`'${value}`);
      },
    );

    it("leaves an ordinary name alone", () => {
      expect(service.safeText("شركة الاختبار")).toBe("شركة الاختبار");
      expect(service.safeText("Al-Faisal Trading")).toBe("Al-Faisal Trading");
    });

    it("writes a template the parser accepts back", async () => {
      // The round trip is the point: a template nobody could upload is
      // worse than no template.
      const template = await service.buildTemplate(HEADERS, ["a rule"]);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(template as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      sheet.addRow(GOOD_ROW);
      const filled = Buffer.from(await workbook.xlsx.writeBuffer());

      const parsed = await service.parseUpload(filled);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].values.crNumber).toBe("1010101010");
    });

    it("puts the rules on a second sheet of the template", async () => {
      const template = await service.buildTemplate(HEADERS, [
        "one rule",
        "another rule",
      ]);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(template as unknown as ArrayBuffer);

      expect(workbook.worksheets).toHaveLength(2);
      expect(workbook.worksheets[1].getRow(1).getCell(1).value).toBe(
        "one rule",
      );
    });

    it("carries the row number into the error report", async () => {
      const file = await service.buildErrorReport(
        ["row", "crNumber", "reason"],
        [
          {
            rowNumber: 7,
            values: ["1010101010"],
            reason: "DUPLICATE_CR_IN_FILE",
          },
        ],
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
      const row = workbook.worksheets[0].getRow(2);

      // The number the operator sees in Excel, so the correction is made
      // in the right place.
      expect(row.getCell(1).value).toBe(7);
      expect(row.getCell(3).value).toBe("DUPLICATE_CR_IN_FILE");
    });
  });

  describe("the columns themselves", () => {
    it("has no password column, and no field resembling one", () => {
      const keys = IMPORT_COLUMNS.map((column) => column.key.toLowerCase());

      expect(
        keys.some((key) => key.includes("password") || key.includes("hash")),
      ).toBe(false);
    });

    it("asks only for fields registration already requires", () => {
      expect(IMPORT_COLUMNS.map((column) => column.key)).toEqual([
        "crNumber",
        "legalName",
        "accountType",
        "ownerEmail",
        "primaryMobile1",
        "primaryMobile2",
      ]);
    });
  });
});
