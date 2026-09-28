import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import type { Response } from "express";
import { AuditActorType } from "@prisma/client";
import { AuditService } from "../../audit/audit.service";

/**
 * Turning any admin list into a spreadsheet, once.
 *
 * THE SHARED BASE every register exports through. Four screens use it
 * today — buyers, suppliers, a company's users, a company's audit
 * trail — and the reason it exists is that the parts nobody sees are
 * the parts that must not be re-written per screen: the safe row
 * ceiling, the formula neutralisation, the audit entry, and the
 * filename a browser will actually accept in two scripts.
 *
 * EVERY CELL IS TEXT UNLESS THE CALLER SAYS OTHERWISE. A value opening
 * `=`, `+`, `-` or `@` is a FORMULA to Excel, executed on the reader's
 * machine with the reader's permissions. Registration numbers are the
 * other half of the same problem in reverse: `1010234567` written as a
 * number keeps its value but `0012345678` does not, and a commercial
 * registration that lost its leading zeros is the wrong registration.
 * So identifiers go out as text, and only genuine quantities as
 * numbers.
 *
 * WHAT IS EXPORTED IS WHAT THE CALLER SELECTED. This class never
 * queries; it is handed rows the caller's own authorised read produced.
 * A projection that never selects a password hash, a token or a storage
 * key cannot leak one here.
 */

/**
 * The most rows one export may carry.
 *
 * An export is a report, not a database dump. A page cap of 100 would
 * make it useless and no cap at all would let one request pull an
 * entire table into memory. When the cut bites, the caller is told —
 * silently truncating reads as "this is everything".
 */
export const EXPORT_ROW_CEILING = 5000;

export type ExportCell = string | number | null;

export interface ExportColumn {
  /** The heading, already in the reader's language. */
  header: string;
  /** Wider for addresses and names, narrower for counts. */
  width?: number;
}

export interface ExportRequest {
  /** Names the file and the audit entry, e.g. "companies-traders". */
  kind: string;
  /** Already translated, already ordered to match the table on screen. */
  columns: ExportColumn[];
  rows: ExportCell[][];
  /** Shown to the reader in the filename; the locale's own word. */
  fileLabel: string;
  /** Today, as the caller's clock sees it: YYYY-MM-DD. */
  datePart: string;
  /** True when the ceiling cut the result short. */
  truncated: boolean;
  /** Recorded verbatim in the audit entry — never the rows themselves. */
  filters: Record<string, string | null>;
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  /** Scopes the audit entry when the export belongs to one company. */
  companyId?: string;
}

@Injectable()
export class AdminExportService {
  constructor(private readonly audit: AuditService) {}

  /**
   * Writes the workbook, records that it happened, and sends it.
   *
   * The audit entry is written BEFORE the bytes go out, so an export
   * that fails mid-transfer is still an export that was authorised and
   * attempted — which is the fact an investigation needs.
   */
  async send(res: Response, request: ExportRequest): Promise<void> {
    const file = await this.build(request.columns, request.rows);

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: request.actorId,
      action: "ADMIN_LIST_EXPORTED",
      entityType: request.companyId ? "company" : "admin_export",
      entityId: request.companyId ?? request.kind,
      // WHAT LEFT, not a copy of it. Storing the file would put a
      // second copy of everyone's data in the audit trail.
      after: {
        kind: request.kind,
        rows: request.rows.length,
        truncated: request.truncated,
        ...request.filters,
      },
      requestId: request.requestId,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      ...(request.companyId ? { companyId: request.companyId } : {}),
    });

    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .set(
        "Content-Disposition",
        disposition(request.fileLabel, request.datePart),
      )
      // Tells the browser the file was cut, without the reader having
      // to count rows to find out.
      .set("X-Export-Truncated", String(request.truncated))
      .set("X-Export-Rows", String(request.rows.length))
      .send(file);
  }

  /** The workbook itself. Exposed for tests and for callers that stream. */
  async build(columns: ExportColumn[], rows: ExportCell[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("export");

    sheet.addRow(columns.map((column) => safeText(column.header)));
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow(
        row.map((cell) => {
          if (cell === null) return "";
          // A NUMBER stays a number only when the caller passed one.
          // Everything else — registration numbers, dates, phone
          // numbers, amounts already formatted — goes out as text with
          // its zeros and its precision intact.
          return typeof cell === "number" ? cell : safeText(cell);
        }),
      );
    }

    sheet.columns = columns.map((column) => ({ width: column.width ?? 26 }));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}

/**
 * A value Excel will show rather than run.
 *
 * The leading apostrophe forces text; Excel strips it on display and
 * never evaluates what follows.
 */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * A Content-Disposition two scripts can both survive.
 *
 * TWO FILENAMES ON PURPOSE. `filename=` carries an ASCII fallback for
 * anything that cannot read the extended form, and `filename*=` carries
 * the real Arabic or English name percent-encoded per RFC 5987. Sending
 * only the raw name would put non-Latin bytes in a header, which some
 * proxies mangle and some browsers refuse.
 */
export function disposition(label: string, datePart: string): string {
  const name = `${label}-${datePart}.xlsx`;
  // Strip anything that could end the header or climb a path: a
  // filename is data, and `filename="../../x"` must never become one.
  const cleaned = name.replaceAll(/["\\/\r\n]/g, "");
  const ascii = cleaned.replaceAll(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}
