import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { AccountType, AuditActorType } from "@prisma/client";
import {
  ERROR_CODES,
  type CompanyImportPreview,
  type CompanyImportRowError,
} from "@platform/types";
import { normaliseEmail } from "../../common/security/email.util";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { AuthService } from "../../auth/auth.service";
import { BusinessException } from "../../common/errors/business-exception";
import { RedisService } from "../../common/redis/redis.service";
import {
  CompanyWorkbookService,
  IMPORT_COLUMNS,
  type ParsedRow,
} from "./company-workbook.service";

/**
 * Bringing companies in from a spreadsheet, in two deliberate steps.
 *
 * NOTHING IS WRITTEN BY UPLOADING. The file is read, every row is
 * checked, and the operator is shown what would happen — how many rows
 * are good, which are not and why, and which duplicate something. Only
 * a second, explicit act commits anything.
 *
 * NO SILENT PARTIAL IMPORT. The operator is told plainly that
 * committing takes the VALID rows and leaves the rest, and they choose
 * between doing that and cancelling to fix the file. A run that quietly
 * imported nine of ten rows and said "done" is the failure this shape
 * exists to prevent.
 *
 * NO PASSWORD IS EVER CREATED. Each imported company gets an owner with
 * no password at all — `password_hash` is NULL, which login refuses —
 * and an invitation through the reset flow that already exists. The
 * person sets their own credential, accepts the policies themselves,
 * and the company stays unverified until it goes through verification
 * like any other.
 *
 * SAFE TO RETRY. The commit is idempotent against the registration
 * number: a run repeated after a timeout re-checks every row against
 * the database inside the transaction, and the unique index on
 * `cr_number` is what makes that true rather than the check being.
 */

/** How long a preview stays available to commit. */
const PREVIEW_TTL_SECONDS = 30 * 60;
const PREVIEW_PREFIX = "company_import:";

@Injectable()
export class CompanyImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly redis: RedisService,
    private readonly workbook: CompanyWorkbookService,
  ) {}

  // ----- step one: look, do not touch --------------------------------

  async preview(
    buffer: Buffer,
    fileName: string,
    ctx: {
      actorId: string;
      requestId: string;
      ipAddress?: string;
      userAgent?: string;
    },
    /**
     * The tab the operator uploaded from, and the authority on what
     * this file creates.
     *
     * THE TAB DECIDES, NOT THE COLUMN. A file uploaded on the buyers
     * tab may not create suppliers, whatever a spreadsheet cell says —
     * so a row naming the other kind is REFUSED with a reason rather
     * than quietly imported into the register the operator was not
     * looking at, and a row leaving the column blank takes the tab's
     * kind, which is the one they chose.
     */
    expected: AccountType,
  ): Promise<CompanyImportPreview> {
    const rows = await this.workbook.parseUpload(buffer);

    // Applied before any other check, so the count an operator reads
    // is a count of rows for THIS register.
    for (const row of rows) {
      if (row.values.accountType.trim() === "") {
        row.values.accountType = expected;
      }
    }

    const errors: CompanyImportRowError[] = [];
    const valid: ParsedRow[] = [];

    // Duplicates WITHIN the file are found first: two rows claiming one
    // registration are both wrong, and importing whichever came first
    // would be an arbitrary choice made silently.
    const seen = new Map<string, number>();
    const emails = new Map<string, number>();

    for (const row of rows) {
      const reason = this.staticProblem(row, expected);
      if (reason) {
        errors.push({
          rowNumber: row.rowNumber,
          reason,
          values: this.valuesOf(row),
        });
        continue;
      }

      const cr = row.values.crNumber.trim();
      const email = normaliseEmail(row.values.ownerEmail);

      if (seen.has(cr)) {
        errors.push({
          rowNumber: row.rowNumber,
          reason: "DUPLICATE_CR_IN_FILE",
          values: this.valuesOf(row),
        });
        continue;
      }
      if (emails.has(email)) {
        errors.push({
          rowNumber: row.rowNumber,
          reason: "DUPLICATE_EMAIL_IN_FILE",
          values: this.valuesOf(row),
        });
        continue;
      }

      seen.set(cr, row.rowNumber);
      emails.set(email, row.rowNumber);
      valid.push(row);
    }

    // Then against what the platform already holds.
    const [existingCompanies, existingUsers] = await Promise.all([
      this.prisma.company.findMany({
        where: { crNumber: { in: [...seen.keys()] } },
        select: { crNumber: true },
      }),
      this.prisma.user.findMany({
        // The keys are already normalised below; the stored column is
        // too, since registration and the console both write through
        // `normaliseEmail`. Comparing anything else would let an
        // import create a second account on an address that exists.
        where: { email: { in: [...emails.keys()] } },
        select: { email: true },
      }),
    ]);

    const takenCr = new Set(
      existingCompanies.map((company) => company.crNumber),
    );
    const takenEmail = new Set(
      existingUsers.map((user) => normaliseEmail(user.email)),
    );

    const importable = valid.filter((row) => {
      if (takenCr.has(row.values.crNumber.trim())) {
        errors.push({
          rowNumber: row.rowNumber,
          reason: "CR_ALREADY_REGISTERED",
          values: this.valuesOf(row),
        });
        return false;
      }
      if (takenEmail.has(normaliseEmail(row.values.ownerEmail))) {
        errors.push({
          rowNumber: row.rowNumber,
          reason: "EMAIL_ALREADY_REGISTERED",
          values: this.valuesOf(row),
        });
        return false;
      }
      return true;
    });

    const importId = randomUUID();
    // The FINGERPRINT, not the file. An audit trail holding uploaded
    // spreadsheets is a copy of everyone's data in a second place.
    const fingerprint = createHash("sha256").update(buffer).digest("hex");

    await this.redis
      .getClient()
      .set(
        PREVIEW_PREFIX + importId,
        JSON.stringify({
          actorId: ctx.actorId,
          fileName,
          fingerprint,
          rows: importable,
        }),
        "EX",
        PREVIEW_TTL_SECONDS,
      );

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "COMPANY_IMPORT_PREVIEWED",
      entityType: "company_import",
      entityId: importId,
      after: {
        fileName,
        fingerprint,
        total: rows.length,
        valid: importable.length,
        rejected: errors.length,
      },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      importId,
      fileName,
      total: rows.length,
      valid: importable.length,
      rejected: errors.length,
      duplicates: errors.filter((error) => error.reason.startsWith("DUPLICATE"))
        .length,
      errors: errors.sort((a, b) => a.rowNumber - b.rowNumber),
    };
  }

  // ----- step two: the operator says so ------------------------------

  async commit(
    importId: string,
    ctx: {
      actorId: string;
      requestId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    const raw = await this.redis.getClient().get(PREVIEW_PREFIX + importId);
    if (!raw) {
      throw new NotFoundException(
        "This import is no longer available — upload the file again",
      );
    }

    const stored = JSON.parse(raw) as {
      actorId: string;
      fileName: string;
      fingerprint: string;
      rows: ParsedRow[];
    };

    // The preview belongs to the operator who made it. Another
    // administrator committing somebody else's staged file would be
    // acting on data they never saw.
    if (stored.actorId !== ctx.actorId) {
      throw new BusinessException(
        403,
        ERROR_CODES.FORBIDDEN,
        "This import was prepared by a different administrator",
      );
    }

    const created: { crNumber: string; companyId: string; email: string }[] =
      [];
    const skipped: CompanyImportRowError[] = [];

    // EVERY ROW IS RE-CHECKED INSIDE THE TRANSACTION. The preview was a
    // moment ago; a registration taken since then must not be
    // overwritten, and a retry after a timeout must not duplicate what
    // the first attempt already wrote.
    await this.prisma.$transaction(async (tx) => {
      for (const row of stored.rows) {
        const crNumber = row.values.crNumber.trim();
        const email = normaliseEmail(row.values.ownerEmail);

        const [companyClash, userClash] = await Promise.all([
          tx.company.findUnique({ where: { crNumber }, select: { id: true } }),
          tx.user.findUnique({ where: { email }, select: { id: true } }),
        ]);

        if (companyClash) {
          skipped.push({
            rowNumber: row.rowNumber,
            reason: "CR_ALREADY_REGISTERED",
            values: this.valuesOf(row),
          });
          continue;
        }
        if (userClash) {
          skipped.push({
            rowNumber: row.rowNumber,
            reason: "EMAIL_ALREADY_REGISTERED",
            values: this.valuesOf(row),
          });
          continue;
        }

        const company = await tx.company.create({
          data: {
            crNumber,
            legalName: row.values.legalName.trim(),
            accountType: row.values.accountType
              .trim()
              .toUpperCase() as AccountType,
            // PENDING by default — an imported company is not verified
            // and cannot trade until it goes through verification.
          },
          select: { id: true },
        });

        await tx.user.create({
          data: {
            companyId: company.id,
            email,
            primaryMobile1: row.values.primaryMobile1.trim(),
            primaryMobile2: row.values.primaryMobile2.trim(),
            // NO PASSWORD. Not a default, not a random one nobody
            // knows — none. Login refuses a NULL hash outright, and the
            // invitation below is the only way in.
            passwordHash: null,
          },
        });

        created.push({ crNumber, companyId: company.id, email });
      }

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "COMPANY_IMPORT_COMMITTED",
          entityType: "company_import",
          entityId: importId,
          after: {
            fileName: stored.fileName,
            fingerprint: stored.fingerprint,
            created: created.length,
            skipped: skipped.length,
          },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });

    // The staged file is spent, whatever the outcome — a second commit
    // of the same preview would be a second attempt at rows that are
    // now in the database.
    await this.redis.getClient().del(PREVIEW_PREFIX + importId);

    // INVITATIONS AFTER THE COMMIT. Sending one for a company that then
    // failed to save would be a link into nothing; sending it inside
    // the transaction would hold a database connection open on an email
    // provider.
    let invited = 0;
    for (const entry of created) {
      try {
        await this.auth.forgotPassword(entry.email, {
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        invited += 1;
      } catch {
        // The account exists and can still be invited from the detail
        // screen. Failing the whole import for a mail provider would
        // undo work that succeeded.
      }
    }

    return {
      created: created.length,
      skipped: skipped.length,
      invited,
      errors: skipped,
    };
  }

  // ----- checks ------------------------------------------------------

  /**
   * What is wrong with a row on its own terms.
   *
   * Shape only — nothing here touches the database, so a file with four
   * hundred malformed rows costs four hundred string checks rather than
   * four hundred queries.
   */
  private staticProblem(row: ParsedRow, expected: AccountType): string | null {
    for (const column of IMPORT_COLUMNS) {
      if (column.required && row.values[column.key].trim() === "") {
        return `MISSING_${column.key.toUpperCase()}`;
      }
    }

    const cr = row.values.crNumber.trim();
    // Ten digits, the shape a Saudi commercial registration takes. The
    // authority on it is registration itself; this only rejects what
    // could never be one.
    if (!/^\d{10}$/.test(cr)) return "INVALID_CR_FORMAT";

    const email = row.values.ownerEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "INVALID_EMAIL";

    for (const key of ["primaryMobile1", "primaryMobile2"] as const) {
      // Digits, plus and spaces only. The authority on a Saudi mobile
      // number is the registration flow; this rejects what could never
      // be one rather than re-implementing it.
      if (!/^[+\d][\d\s-]{6,19}$/.test(row.values[key].trim())) {
        return `INVALID_${key.toUpperCase()}`;
      }
    }

    const accountType = row.values.accountType.trim().toUpperCase();
    if (
      accountType !== AccountType.TRADER &&
      accountType !== AccountType.SUPPLIER
    ) {
      return "INVALID_ACCOUNT_TYPE";
    }
    // The two registers stay apart. This is the check that makes
    // "buyers tab imports buyers" a property of the system rather than
    // a habit of whoever prepared the file.
    if (accountType !== expected) {
      return "ACCOUNT_TYPE_MISMATCH";
    }

    return null;
  }

  private valuesOf(row: ParsedRow): string[] {
    return IMPORT_COLUMNS.map((column) => row.values[column.key]);
  }
}
