import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { AuditLogEntry, Paginated } from "@platform/types";
import { AdminAuditService } from "./admin-audit.service";
import { AdminAuditQueryDto } from "./dto/admin-audit-query.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";

/**
 * The audit trail, read-only.
 *
 * No `CsrfGuard`: every route here is a GET and the provider exempts
 * safe methods, so adding it would suggest a write that does not exist.
 *
 * READING WRITES NOTHING. A read that audits itself makes the table grow
 * from browsing and buries the actions worth finding under records of
 * people looking for them.
 */
@Controller("admin/audit-logs")
@UseGuards(AdminSessionAuthGuard)
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  list(@Query() query: AdminAuditQueryDto): Promise<Paginated<AuditLogEntry>> {
    return this.audit.list(query);
  }

  /** The distinct actions present, so a filter offers only what exists. */
  @Get("actions")
  actions(): Promise<string[]> {
    return this.audit.actions();
  }
}
