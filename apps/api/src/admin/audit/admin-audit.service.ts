import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuditLogEntry, Paginated } from "@platform/types";
import { PrismaService } from "../../database/prisma.service";

/**
 * Reading the audit trail.
 *
 * NINE FIELDS. `beforeData`, `afterData`, `ipAddress` and `userAgent`
 * are not selected — not filtered afterwards, not selected. They are the
 * whole reason this projection is narrow:
 *
 *   - `beforeData`/`afterData` are arbitrary JSON copies of rows, so
 *     they carry whatever the row carried: a billing name, an email, a
 *     masked IBAN, an administrator's internal note. Someone reading the
 *     trail needs to know that something changed, who changed it and
 *     why — not a replay of the values.
 *   - `ipAddress`/`userAgent` are request metadata about a person, kept
 *     for forensics. Reaching them is a database question with its own
 *     authorisation, not a page in a portal.
 *
 * `reason` IS included: it is written deliberately by an administrator
 * to explain a decision, which is the opposite of incidental capture.
 *
 * READING THE AUDIT LOG WRITES NO AUDIT LOG. A read that audits itself
 * makes the table grow without bound from browsing, and buries the
 * actions worth finding under records of people looking for them.
 */

const AUDIT_SELECT = {
  id: true,
  actorType: true,
  actorId: true,
  action: true,
  entityType: true,
  entityId: true,
  reason: true,
  requestId: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_SELECT }>;

function toEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    actorType: row.actorType as AuditLogEntry["actorType"],
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    reason: row.reason,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  actorType?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  requestId?: string;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditQuery): Promise<Paginated<AuditLogEntry>> {
    const page = Math.max(1, query.page ?? 1);
    // Capped at 100. The plan is explicit that a larger request clamps
    // rather than being honoured — an audit table is the one place where
    // "give me everything" is both tempting and expensive.
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorType ? { actorType: query.actorType as never } : {}),
      // `action` is an exact match, not a contains: the vocabulary is a
      // closed set of constants written by this codebase, and a
      // substring search over it invites `%` in a filter box.
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: AUDIT_SELECT,
        // Terminating in the primary key: `createdAt` is not unique, and
        // a tie spanning a page boundary can serve one row twice and
        // another never.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items: rows.map(toEntry), page, pageSize, total };
  }

  /**
   * The distinct actions present, for a filter that offers only what
   * exists.
   *
   * A hardcoded list would drift the moment a new action is logged;
   * reading the column means the filter is always the real vocabulary.
   */
  async actions(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
      take: 500,
    });
    return rows.map((row) => row.action);
  }
}
