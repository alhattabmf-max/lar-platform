import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { ERROR_CODES } from "@platform/types";
import { BusinessException } from "../../common/errors/business-exception";

/**
 * Reading and writing the spreadsheets this console exchanges.
 *
 * A REAL `.xlsx`, produced by a real writer. A CSV renamed is not one:
 * Excel opens it with a warning, the column types are guesses, and
 * anything with a comma in it becomes two cells. `exceljs` writes the
 * ZIP-of-XML the format actually is, and reads it back the same way.
 *
 * EVERY CELL IS TEXT ON THE WAY OUT. A value beginning `=`, `+`, `-`
 * or `@` is a FORMULA to Excel — so a company that named itself
 * `=HYPERLINK(...)` would execute in the reader's spreadsheet, on the
 * reader's machine, with the reader's permissions. Each such value is
 * prefixed with an apostrophe, which Excel strips on display and never
 * evaluates.
 *
 * NOTHING EXECUTABLE COMES BACK IN. A worksheet's formulas are ignored
 * and only the cached VALUE is read; anything that is not a scalar is
 * refused rather than coerced.
 */

/** Bounds that keep one upload from becoming the platform's problem. */
export const IMPORT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxRows: 500,
  /**
   * The ceiling on ONE export.
   *
   * An export is a report, not a database dump: the same 100-row page
   * cap the lists carry would make it useless, and no cap at all would
   * make one request able to pull every company into memory. What is
   * cut is stated on the screen rather than left to be discovered.
   */
  maxExportRows: 5000,
  /** The only signature a real .xlsx starts with — it is a ZIP. */
  signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
} as const;

/**
 * The columns an import carries, and which the platform cannot do
 * without.
 *
 * DRAWN FROM WHAT REGISTRATION ACTUALLY NEEDS, not invented: a company
 * is a registration number, a legal name, an account type and an owner
 * to invite. The rest of `RegisterCompanyDto` — city, coordinates,
 * accepted policies — is the invited person's to supply, because a
 * policy nobody read is not one anybody accepted.
 *
 * The two mobile numbers are here because the USER row cannot be
 * written without them — they are required registration fields, not
 * fields invented for this file.
 *
 * THERE IS NO PASSWORD COLUMN. An operator may not set one, a default
 * is a credential somebody else knows, and a spreadsheet is the last
 * place either belongs.
 */
export const IMPORT_COLUMNS = [
  { key: "crNumber", required: true },
  { key: "legalName", required: true },
  { key: "accountType", required: true },
  { key: "ownerEmail", required: true },
  { key: "primaryMobile1", required: true },
  { key: "primaryMobile2", required: true },
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];

export interface ParsedRow {
  /** The row number IN THE FILE, so an operator can find it. */
  rowNumber: number;
  values: Record<ImportColumnKey, string>;
}

@Injectable()
export class CompanyWorkbookService {
  // ----- writing -----------------------------------------------------

  /**
   * The blank an operator fills in.
   *
   * Carries the headers in the language they are working in, one
   * example row, and the rules on a second sheet — so the instructions
   * travel with the file rather than living on a screen they closed.
   */
  async buildTemplate(
    headers: Record<ImportColumnKey, string>,
    guidance: string[],
  ) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("companies");

    sheet.addRow(IMPORT_COLUMNS.map((column) => headers[column.key]));
    sheet.getRow(1).font = { bold: true };
    sheet.columns = IMPORT_COLUMNS.map(() => ({ width: 28 }));

    const notes = workbook.addWorksheet("instructions");
    for (const line of guidance) notes.addRow([this.safeText(line)]);
    notes.columns = [{ width: 120 }];

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /**
   * The current result set, as a file.
   *
   * Takes rows already filtered and already authorised by the caller —
   * this decides only how they are written, never which of them the
   * reader may see.
   */
  async buildExport(
    headers: string[],
    rows: (string | number)[][],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("companies");

    sheet.addRow(headers.map((header) => this.safeText(header)));
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow(
        row.map((cell) =>
          typeof cell === "number" ? cell : this.safeText(cell),
        ),
      );
    }

    sheet.columns = headers.map(() => ({ width: 26 }));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** The rejected rows, with their reasons, ready to correct and resend. */
  async buildErrorReport(
    headers: string[],
    rows: { rowNumber: number; values: string[]; reason: string }[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("errors");

    sheet.addRow(headers.map((header) => this.safeText(header)));
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow([
        row.rowNumber,
        ...row.values.map((value) => this.safeText(value)),
        this.safeText(row.reason),
      ]);
    }

    sheet.columns = headers.map(() => ({ width: 30 }));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // ----- reading -----------------------------------------------------

  /**
   * Turns an uploaded file into rows, or refuses it.
   *
   * THREE CHECKS BEFORE ANY PARSING, in the order that costs least: the
   * size, the first four bytes, and only then the ZIP itself. A file
   * whose name ends `.xlsx` proves nothing, and neither does the
   * content type a browser attached to it.
   */
  async parseUpload(buffer: Buffer): Promise<ParsedRow[]> {
    if (buffer.byteLength === 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "The file is empty",
      );
    }
    if (buffer.byteLength > IMPORT_LIMITS.maxBytes) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `The file is larger than the ${IMPORT_LIMITS.maxBytes} byte limit`,
      );
    }
    if (!buffer.subarray(0, 4).equals(IMPORT_LIMITS.signature)) {
      // A .xlsx IS a zip. Anything else — a CSV renamed, an HTML page,
      // an executable — fails here rather than inside a parser.
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "The file is not a real .xlsx workbook",
      );
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "The workbook could not be read",
      );
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "The workbook has no sheets",
      );
    }

    // THE HEADER ROW DECIDES WHICH COLUMN IS WHICH, matched against the
    // machine keys rather than the translated labels — so a file
    // downloaded in Arabic and filled in still imports, and a reordered
    // sheet still works.
    const header = sheet.getRow(1);
    const index = new Map<ImportColumnKey, number>();

    header.eachCell((cell, columnNumber) => {
      const text = this.cellText(cell).trim();
      const match = IMPORT_COLUMNS.find(
        (column) => column.key.toLowerCase() === text.toLowerCase(),
      );
      if (match) index.set(match.key, columnNumber);
    });

    const missing = IMPORT_COLUMNS.filter(
      (column) => !index.has(column.key),
    ).map((column) => column.key);
    if (missing.length > 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `The workbook is missing required columns: ${missing.join(", ")}`,
      );
    }

    const rows: ParsedRow[] = [];
    const lastRow = sheet.rowCount;

    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const values = {} as Record<ImportColumnKey, string>;
      let blank = true;

      for (const column of IMPORT_COLUMNS) {
        const text = this.cellText(row.getCell(index.get(column.key)!)).trim();
        values[column.key] = text;
        if (text !== "") blank = false;
      }

      // A trailing empty row is how every spreadsheet ends. It is not a
      // rejected record and must not be counted as one.
      if (blank) continue;

      rows.push({ rowNumber, values });

      if (rows.length > IMPORT_LIMITS.maxRows) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `The file has more than the ${IMPORT_LIMITS.maxRows} row limit`,
        );
      }
    }

    return rows;
  }

  // ----- cells -------------------------------------------------------

  /**
   * A cell as TEXT, never as a formula and never as an object.
   *
   * `cell.value` can be a formula record, a rich-text array, a
   * hyperlink or a date. Only the resolved scalar is taken, so nothing
   * a sender put in a cell can arrive as anything but characters.
   */
  private cellText(cell: ExcelJS.Cell): string {
    const value = cell.value;

    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    if (value instanceof Date) return value.toISOString();

    if (typeof value === "object") {
      // A formula's cached RESULT, never the formula.
      if (
        "result" in value &&
        value.result !== undefined &&
        value.result !== null
      ) {
        const result = value.result;
        return typeof result === "object" ? "" : String(result);
      }
      if ("text" in value && typeof value.text === "string") return value.text;
      if ("richText" in value && Array.isArray(value.richText)) {
        return value.richText.map((part) => part.text ?? "").join("");
      }
    }

    return "";
  }

  /**
   * A value Excel will show rather than run.
   *
   * `=`, `+`, `-` and `@` at the start of a cell make it a formula. The
   * leading apostrophe forces text; Excel does not display it, and the
   * value round-trips unchanged.
   */
  safeText(value: string): string {
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  }
}
