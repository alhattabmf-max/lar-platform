import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { CompanyVerificationStatus } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { PrismaService } from "../../database/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { SessionService } from "../../common/security/session.service";
import { AuditService } from "../../audit/audit.service";
import { BusinessException } from "../../common/errors/business-exception";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";
import { CompanyDetailService } from "./company-detail.service";
import { CompanyBranchService } from "./company-branch.service";
import { CreateBranchDto, UpdateBranchDto } from "./dto/company-branch.dto";
import { CompanyControlService } from "./company-control.service";
import { CompanyDeletionEligibilityService } from "./company-deletion-eligibility.service";
import { CompanyImportService } from "./company-import.service";
import {
  CompanyWorkbookService,
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
} from "./company-workbook.service";
import { AdminCompaniesQueryDto } from "../directory/dto/admin-list-query.dto";
import { companyWhere } from "../directory/admin-directory.service";
import {
  AdminExportService,
  EXPORT_ROW_CEILING,
} from "../exports/admin-export.service";
import { ExportLabelsDto } from "../exports/dto/export-labels.dto";
import { CompanyExportQueryDto } from "../exports/dto/company-export-query.dto";
import {
  DeleteCompanyDto,
  SuspendCompanyDto,
  UpdateCompanyDto,
} from "./dto/company-control.dto";
import { AccountType, AuditActorType } from "@prisma/client";

/**
 * Administrative control over one company.
 *
 * THE ONE `@Delete` OUTSIDE ARTWORK. Nothing else in this console is
 * hard-deleted: reference data deactivates, products close,
 * administrators are disabled. A company with no financial, legal or
 * operational record is the narrow exception, argued in writing in
 * `admin-routes.spec.ts`, and the server — not the screen — is what
 * enforces it.
 *
 * TWO ROUTES DEMAND A FRESH CODE: removal, and rewriting the commercial
 * registration. Both are irreversible or identity-changing, and a
 * session cookie only proves somebody signed in at some point.
 */

function ctxFrom(session: AdminSessionData, req: Request) {
  return {
    actorId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("admin/companies")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminCompanyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly detail: CompanyDetailService,
    private readonly control: CompanyControlService,
    private readonly eligibility: CompanyDeletionEligibilityService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly imports: CompanyImportService,
    private readonly workbook: CompanyWorkbookService,
    private readonly exports: AdminExportService,
    private readonly branches: CompanyBranchService,
  ) {}

  // ----- spreadsheets ------------------------------------------------

  /**
   * The blank an operator fills in.
   *
   * DECLARED BEFORE `:id`, because Nest matches routes in declaration
   * order and `import-template` would otherwise be read as a company id
   * and rejected by `ParseUUIDPipe`.
   *
   * The column headers are the MACHINE KEYS, in both languages, because
   * the reader matches on them: a template downloaded in Arabic, filled
   * in, and uploaded still imports.
   */
  @Get("import-template")
  async template(@Query() query: AdminCompaniesQueryDto, @Res() res: Response) {
    // The tab's kind, so the blank an operator downloads on the
    // suppliers tab is a suppliers blank.
    const kind =
      query.accountType === "SUPPLIER"
        ? AccountType.SUPPLIER
        : AccountType.TRADER;

    const headers = Object.fromEntries(
      IMPORT_COLUMNS.map((column) => [column.key, column.key]),
    ) as Record<(typeof IMPORT_COLUMNS)[number]["key"], string>;

    // THE RULES TRAVEL WITH THE FILE. An operator who downloads this in
    // the morning and fills it in that afternoon has long closed the
    // screen the instructions were printed on.
    const file = await this.workbook.buildTemplate(headers, [
      "One company per row. Do not rename or remove the header row.",
      "crNumber: exactly 10 digits. One registration, one company.",
      "legalName: the name as registered.",
      `accountType: ${kind}. This template is for ${kind} accounts; a row naming the other kind is refused rather than imported into the wrong register.`,
      "ownerEmail: the person who will be invited to claim the account.",
      "primaryMobile1 and primaryMobile2: that person's contact numbers.",
      "There is no password column and none may be added — the invited person sets their own.",
      `At most ${IMPORT_LIMITS.maxRows} rows, and at most ${IMPORT_LIMITS.maxBytes} bytes.`,
      "Every imported company starts unverified and cannot trade until it is verified.",
    ]);

    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .set(
        "Content-Disposition",
        `attachment; filename="companies-${kind.toLowerCase()}-template.xlsx"`,
      )
      .send(file);
  }

  /**
   * The current result set, as a file.
   *
   * TAKES THE SAME FILTERS THE LIST TAKES — the very DTO the directory
   * read validates against — so what lands in the file is what the
   * operator is looking at, and the two cannot drift on what a valid
   * filter is.
   *
   * NO SECRET IS SELECTED. The query asks for six columns; a password
   * hash, a token or a bank detail is not among them, so there is no
   * redaction step that could be forgotten.
   */
  @Get("export")
  async export(
    // ONE class carrying both the filters and the headings. Two
    // `@Query()` parameters would each reject the other's fields under
    // `forbidNonWhitelisted`, and every export would 400.
    @Query() query: CompanyExportQueryDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const labels = query;
    const search = query.search?.trim();
    const supplierTab = query.accountType === "SUPPLIER";

    const rows = await this.prisma.company.findMany({
      // THE SAME PREDICATE THE TABLE USES. A file narrowed by different
      // rules from the screen it came from is a file nobody can check.
      where: companyWhere(query),
      select: {
        id: true,
        crNumber: true,
        legalName: true,
        accountType: true,
        verificationStatus: true,
        createdAt: true,
        users: {
          orderBy: { createdAt: "asc" },
          take: 1,
          where: { role: "OWNER" as const },
          select: { email: true },
        },
        _count: {
          select: { users: true, products: true, opportunities: true },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      // One over the ceiling, so a full page can be distinguished from
      // one that was cut — a count equal to the cap is ambiguous.
      take: EXPORT_ROW_CEILING + 1,
    });

    const truncated = rows.length > EXPORT_ROW_CEILING;
    const page = truncated ? rows.slice(0, EXPORT_ROW_CEILING) : rows;

    // ORDERS ONLY FOR THE BUYERS' FILE, matching the buyers' table.
    const orderCounts = supplierTab
      ? []
      : await this.prisma.masterOrder.groupBy({
          by: ["traderCompanyId"],
          where: { traderCompanyId: { in: page.map((row) => row.id) } },
          _count: { _all: true },
        });
    const ordersById = new Map(
      orderCounts.map((entry) => [entry.traderCompanyId, entry._count._all]),
    );

    // THE COLUMNS THE TAB ON SCREEN HAS, in its order. A file whose
    // columns differ from the table it came from is a file nobody can
    // check against what they were looking at.
    const columns = supplierTab
      ? [
          { header: labels.c1 ?? "legalName", width: 34 },
          { header: labels.c2 ?? "crNumber", width: 18 },
          { header: labels.c3 ?? "verificationStatus", width: 20 },
          { header: labels.c4 ?? "ownerEmail", width: 32 },
          { header: labels.c5 ?? "userCount", width: 14 },
          { header: labels.c6 ?? "productCount", width: 14 },
          { header: labels.c7 ?? "opportunityCount", width: 14 },
          { header: labels.c8 ?? "createdAt", width: 16 },
        ]
      : [
          { header: labels.c1 ?? "legalName", width: 34 },
          { header: labels.c2 ?? "crNumber", width: 18 },
          { header: labels.c3 ?? "ownerEmail", width: 32 },
          { header: labels.c4 ?? "userCount", width: 14 },
          { header: labels.c5 ?? "orderCount", width: 14 },
          { header: labels.c6 ?? "createdAt", width: 16 },
        ];

    await this.exports.send(res, {
      kind: supplierTab ? "companies-suppliers" : "companies-traders",
      columns,
      rows: page.map((row) =>
        supplierTab
          ? [
              row.legalName,
              // TEXT, not a number: a registration that lost its
              // leading zeros is a different registration.
              row.crNumber,
              labels.statusLabel(row.verificationStatus) ??
                row.verificationStatus,
              row.users[0]?.email ?? "",
              row._count.users,
              row._count.products,
              row._count.opportunities,
              row.createdAt.toISOString().slice(0, 10),
            ]
          : [
              row.legalName,
              row.crNumber,
              row.users[0]?.email ?? "",
              row._count.users,
              ordersById.get(row.id) ?? 0,
              row.createdAt.toISOString().slice(0, 10),
            ],
      ),
      fileLabel: labels.fileLabel ?? (supplierTab ? "suppliers" : "traders"),
      datePart: labels.safeDate(),
      truncated,
      filters: {
        search: search ?? null,
        accountType: query.accountType ?? null,
        verificationStatus: query.verificationStatus ?? null,
        operationalStatus: query.operationalStatus ?? null,
        registeredFrom: query.registeredFrom ?? null,
        registeredTo: query.registeredTo ?? null,
      },
      actorId: session.adminUserId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  /**
   * One company's people, as a file.
   *
   * NO CREDENTIAL LEAVES THIS ROUTE. The projection asks for an email,
   * a role, a status and a date; `password_hash` is not selected, and
   * whether a password exists at all is reduced to a word before it is
   * written.
   */
  @Get(":id/users/export")
  async exportUsers(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() labels: ExportLabelsDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, legalName: true },
    });
    if (!company) throw new NotFoundException("Company not found");

    const users = await this.prisma.user.findMany({
      where: { companyId: id },
      select: {
        email: true,
        role: true,
        status: true,
        passwordHash: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: EXPORT_ROW_CEILING + 1,
    });

    const truncated = users.length > EXPORT_ROW_CEILING;
    const page = truncated ? users.slice(0, EXPORT_ROW_CEILING) : users;

    await this.exports.send(res, {
      kind: "company-users",
      companyId: id,
      columns: [
        { header: labels.c1 ?? "email", width: 32 },
        { header: labels.c2 ?? "role", width: 18 },
        { header: labels.c3 ?? "status", width: 16 },
        { header: labels.c4 ?? "password", width: 22 },
        { header: labels.c5 ?? "createdAt", width: 16 },
      ],
      rows: page.map((user) => [
        user.email,
        labels.roleLabel(user.role) ?? user.role,
        labels.userStatusLabel(user.status) ?? user.status,
        // A WORD, never the hash and never its length.
        user.passwordHash !== null
          ? (labels.passwordSet ?? "set")
          : (labels.passwordPending ?? "pending"),
        user.createdAt.toISOString().slice(0, 10),
      ]),
      fileLabel: labels.fileLabel ?? "company-users",
      datePart: labels.safeDate(),
      truncated,
      filters: { companyName: company.legalName },
      actorId: session.adminUserId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  /**
   * One company's audit trail, as a file.
   *
   * The before/after columns carry the SAME narrowed view the screen
   * shows — the detail service's allow-list — so an export can never
   * reveal a field the page deliberately withholds.
   */
  @Get(":id/audit/export")
  async exportAudit(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() labels: ExportLabelsDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, legalName: true },
    });
    if (!company) throw new NotFoundException("Company not found");

    const entries = await this.detail.auditTrail(id, EXPORT_ROW_CEILING + 1);
    const truncated = entries.length > EXPORT_ROW_CEILING;
    const page = truncated ? entries.slice(0, EXPORT_ROW_CEILING) : entries;

    await this.exports.send(res, {
      kind: "company-audit",
      companyId: id,
      columns: [
        { header: labels.c1 ?? "action", width: 30 },
        { header: labels.c2 ?? "actor", width: 16 },
        { header: labels.c3 ?? "reason", width: 40 },
        { header: labels.c4 ?? "before", width: 30 },
        { header: labels.c5 ?? "after", width: 30 },
        { header: labels.c6 ?? "at", width: 22 },
      ],
      rows: page.map((entry) => [
        labels.actionLabel(entry.action) ?? entry.action,
        entry.actorType,
        entry.reason ?? "",
        formatChange(entry.before),
        formatChange(entry.after),
        entry.createdAt,
      ]),
      fileLabel: labels.fileLabel ?? "company-audit",
      datePart: labels.safeDate(),
      truncated,
      filters: { companyName: company.legalName },
      actorId: session.adminUserId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  /**
   * Step one of an import: read the file, write nothing.
   *
   * The multer limit is a SECOND ceiling under the service's own — it
   * stops an oversized body before it is fully buffered, rather than
   * after.
   */
  @Post("import")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: IMPORT_LIMITS.maxBytes } }),
  )
  previewImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query() query: AdminCompaniesQueryDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'A file field named "file" is required',
      );
    }

    return this.imports.preview(
      file.buffer,
      file.originalname,
      ctxFrom(session, req),
      query.accountType === "SUPPLIER"
        ? AccountType.SUPPLIER
        : AccountType.TRADER,
    );
  }

  /**
   * Step two: the operator says to go ahead.
   *
   * Takes the VALID rows and leaves the rest — which the screen states
   * in those words before this is reachable, so nothing is ever
   * imported partially in silence.
   */
  @Post("import/:importId/commit")
  commitImport(
    @Param("importId", ParseUUIDPipe) importId: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.imports.commit(importId, ctxFrom(session, req));
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.detail.findOne(id);
  }

  @Get(":id/deletion-eligibility")
  checkDeletion(@Param("id", ParseUUIDPipe) id: string) {
    return this.eligibility.check(id);
  }

  /**
   * The ordinary edit.
   *
   * REFUSES OUTRIGHT for a verified company's registration by not
   * accepting the field at all — `UpdateCompanyDto` has one property.
   * A rule enforced by the shape of the request is one nobody can
   * forget to apply.
   */
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.detail.update(
      id,
      {
        legalName: dto.legalName,
        crNumber: dto.crNumber,
        ownerEmail: dto.ownerEmail,
        primaryMobile1: dto.primaryMobile1,
        primaryMobile2: dto.primaryMobile2,
      },
      dto.reason,
      ctxFrom(session, req),
    );
  }

  // THE SEPARATE `cr-number` ROUTE IS GONE.
  //
  // The registration is now part of the ordinary edit above, without a
  // second factor. Keeping the old route beside it would leave two ways
  // to write one column under two different rules — and the weaker one
  // would be the one anybody wanting to skip the code would use. A
  // control that can be walked around is not a control.

  /**
   * A new branch, added from the company's own page.
   *
   * NO SECOND FACTOR: an address and a telephone number are a
   * correction, not a change of identity.
   */
  @Post(":id/branches")
  addBranch(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateBranchDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.branches.create(id, dto, ctxFrom(session, req));
  }

  @Patch(":id/branches/:branchId")
  editBranch(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.branches.update(id, branchId, dto, ctxFrom(session, req));
  }

  @Post(":id/suspend")
  suspend(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SuspendCompanyDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.control.suspend(id, dto.reason, ctxFrom(session, req));
  }

  @Post(":id/reactivate")
  reactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.control.reactivate(id, ctxFrom(session, req));
  }

  @Delete(":id")
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DeleteCompanyDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { legalName: true, crNumber: true },
    });
    if (!company) throw new NotFoundException("Company not found");

    // TYPED OUT, not clicked. The difference between meaning to remove
    // this company and having the wrong row on screen is exactly this
    // check, and it is done here so a direct caller meets it too.
    const typed = dto.confirmation.trim();
    if (
      typed !== company.legalName.trim() &&
      typed !== company.crNumber.trim()
    ) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Confirmation does not match the company's legal name or commercial registration",
      );
    }

    // NO SECOND FACTOR. The typed confirmation above is the proof
    // that this is the right company: a code from an authenticator
    // says who is at the keyboard, which the session already
    // established, and says nothing at all about which row is on
    // screen. It was a second prompt in front of a decision the
    // operator had already made twice — the name typed out, and a
    // written reason.
    return this.control.remove(id, dto.reason, ctxFrom(session, req));
  }

  // ----- the company's people ----------------------------------------

  /**
   * Sends the user a link to set a new password.
   *
   * THROUGH THE FLOW THAT ALREADY EXISTS. `AuthService.forgotPassword`
   * mints the single-use, expiring token, stores only its hash, and
   * delivers it to the address on file. Nothing here sees the token,
   * and no parallel mechanism is invented beside it.
   *
   * The AUDIT RECORDS THE REQUEST, not the link: who asked, for whom,
   * and when. A token in an audit trail is a password reset anyone with
   * read access can complete.
   */
  @Post(":id/users/:userId/password-reset")
  async sendPasswordReset(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    const user = await this.requireCompanyUser(id, userId);
    const ctx = ctxFrom(session, req);

    await this.auth.forgotPassword(user.email, {
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: session.adminUserId,
      companyId: id,
      action: "COMPANY_USER_PASSWORD_RESET_REQUESTED",
      entityType: "user",
      entityId: userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { status: "SENT" };
  }

  /** Ends every session this user currently holds. */
  @Post(":id/users/:userId/revoke-sessions")
  async revokeSessions(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    await this.requireCompanyUser(id, userId);
    const ctx = ctxFrom(session, req);

    await this.sessions.revokeAllForUser(userId);

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: session.adminUserId,
      companyId: id,
      action: "COMPANY_USER_SESSIONS_REVOKED",
      entityType: "user",
      entityId: userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { status: "REVOKED" };
  }

  /**
   * The user, only if they belong to THIS company.
   *
   * Both ids come from the path, and accepting a user id without
   * checking whose it is would let one company's screen act on another
   * company's person.
   */
  private async requireCompanyUser(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException("User not found for this company");
    return user;
  }
}

/** Re-exported so the module and the tests name one thing. */
export const COMPANY_SUSPENDED_STATUS = CompanyVerificationStatus.SUSPENDED;

/** An audit change as one readable cell, or empty when there was none. */
function formatChange(value: Record<string, string> | null): string {
  if (!value) return "";
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${entry}`)
    .join(" | ");
}
