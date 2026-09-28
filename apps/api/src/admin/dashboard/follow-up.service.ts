import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AuditActorType,
  FollowUpCaseKind,
  SupplierVerificationRequestStatus,
} from "@prisma/client";
import type {
  FollowUpBoard,
  FollowUpCase,
  FollowUpPriority,
  DashboardPeriod,
} from "@platform/types";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { resolvePeriod } from "./dashboard-period";
import { RESOLVED_DISPUTE_STATUSES } from "./order-stage";

/**
 * The cases that need an administrator, gathered from where they live.
 *
 * A CASE IS NOT A ROW ANYWHERE. Every one is DERIVED: an unresolved
 * dispute, a bank account still awaiting review, a delivered allocation
 * nobody has settled. That is what makes the requirement structural
 * rather than a rule to remember — there is no closed flag to set, so
 * opening a case cannot close it, and a case leaves this list only when
 * its cause is resolved in its own table.
 *
 * `follow_up_assignments` HOLDS THE TWO FACTS A DERIVATION CANNOT
 * PRODUCE: who owns the case, and whether they have started. Nothing
 * else. No amount, no party's name, no dispute text — a kind and a
 * reference.
 *
 * THE FOUR CARDS ARE COUNTED FROM THE SAME LIST the table renders, so a
 * heading and the rows under it cannot disagree.
 */

interface Ctx {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/** A derived case, before assignment is attached. */
interface RawCase {
  /**
   * THE CONTRACT KIND, NOT THE DATABASE ENUM. The Postgres enum still
   * carries PRODUCT_REVIEW — dropping a value from a live enum is a
   * migration, and nothing here is worth one — but the platform can no
   * longer raise a case of that kind. Typing the derived case against
   * the contract is what makes that a compiler error rather than a note.
   */
  kind: FollowUpCase["kind"];
  caseRef: string;
  priority: FollowUpPriority;
  subject: string;
  since: Date;
  actionHref: string;
}

/**
 * HOW MANY OPEN CASES OF ONE KIND THE BOARD WILL DRAW.
 *
 * The board is built by merging four unrelated queues in memory,
 * ranking them by urgency and paging the result — so every source has
 * to be read before the first page can be shown, and each of them grows
 * with the platform rather than with one account.
 *
 * A DELIBERATE CEILING PER SOURCE, NOT A PAGE. Each query is ordered
 * OLDEST FIRST and cut at the far end, so what the ceiling drops is the
 * newest and least urgent work — the board never loses the case that
 * has been waiting longest.
 *
 * Five hundred unsettled payouts, or five hundred open disputes, is not
 * a paging problem. It is a backlog somebody has to be told about, and
 * the honest fix at that point is to rank these queues in SQL rather
 * than to raise this number.
 */
const MAX_CASES_PER_SOURCE = 500;

@Injectable()
export class FollowUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async board(query: {
    period: DashboardPeriod;
    search?: string;
    priority?: string;
    kind?: string;
    assignee?: string;
    page?: number;
    pageSize?: number;
    now?: Date;
  }): Promise<FollowUpBoard> {
    const now = query.now ?? new Date();
    const range = resolvePeriod(query.period, now).current;

    const derived = await this.derive();

    const [assignments, admins] = await Promise.all([
      this.prisma.followUpAssignment.findMany({
        // ONLY THE ASSIGNMENTS OF THE CASES ON THE BOARD.
        //
        // This read the WHOLE assignment table to build a lookup, and
        // that table grows with every case ever handed to somebody —
        // while the board itself only ever asks about the cases open
        // right now. Naming them bounds the read by the size of the
        // board instead of by the platform's history.
        //
        // The map is keyed by kind AND ref below, so narrowing on the
        // ref alone is a superset of what is needed — never less.
        where: { caseRef: { in: derived.map((raw) => raw.caseRef) } },
        select: {
          caseKind: true,
          caseRef: true,
          assigneeId: true,
          inProgress: true,
          assignee: { select: { id: true, email: true } },
        },
      }),
      this.prisma.adminUser.findMany({
        // ACTIVE administrators only: a disabled account cannot be
        // handed a case it will never see.
        where: { status: "ACTIVE" },
        select: { id: true, email: true },
        orderBy: { email: "asc" },
      }),
    ]);

    const byCase = new Map(
      assignments.map((row) => [`${row.caseKind}:${row.caseRef}`, row]),
    );

    let cases: FollowUpCase[] = derived.map((raw) => {
      const key = `${raw.kind}:${raw.caseRef}`;
      const assignment = byCase.get(key);

      return {
        id: key,
        kind: raw.kind,
        caseRef: raw.caseRef,
        priority: raw.priority,
        subject: raw.subject,
        ageHours: Math.max(
          0,
          Math.floor((now.getTime() - raw.since.getTime()) / (60 * 60 * 1000)),
        ),
        assigneeId: assignment?.assigneeId ?? null,
        assigneeName: assignment?.assignee?.email ?? null,
        inProgress: assignment?.inProgress ?? false,
        actionHref: raw.actionHref,
      };
    });

    // THE SUMMARY IS COUNTED BEFORE FILTERING, from the whole set: the
    // four cards describe what is waiting, not what the current filter
    // happens to show.
    const summary = {
      total: cases.length,
      review: cases.filter((row) => row.priority === "REVIEW").length,
      overdue: cases.filter((row) => row.priority === "OVERDUE").length,
      critical: cases.filter((row) => row.priority === "CRITICAL").length,
    };

    const search = query.search?.trim().toLowerCase();
    if (search) {
      cases = cases.filter(
        (row) =>
          row.subject.toLowerCase().includes(search) ||
          row.caseRef.toLowerCase().includes(search),
      );
    }
    if (query.priority)
      cases = cases.filter((row) => row.priority === query.priority);
    if (query.kind) cases = cases.filter((row) => row.kind === query.kind);
    if (query.assignee === "UNASSIGNED") {
      cases = cases.filter((row) => row.assigneeId === null);
    } else if (query.assignee) {
      cases = cases.filter((row) => row.assigneeId === query.assignee);
    }

    // Most urgent first, then oldest — which is the order somebody
    // working through the list would choose anyway.
    const rank: Record<FollowUpPriority, number> = {
      CRITICAL: 0,
      OVERDUE: 1,
      REVIEW: 2,
    };
    cases.sort(
      (a, b) => rank[a.priority] - rank[b.priority] || b.ageHours - a.ageHours,
    );

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const total = cases.length;

    return {
      range,
      generatedAt: now.toISOString(),
      summary,
      cases: cases.slice((page - 1) * pageSize, page * pageSize),
      assignees: admins.map((admin) => ({ id: admin.id, name: admin.email })),
      page,
      pageSize,
      total,
    };
  }

  // ----- where the cases come from ------------------------------------

  private async derive(): Promise<RawCase[]> {
    const [
      settlements,
      repeatedFailures,
      disputes,
      suppliers,
    ] = await Promise.all([
      this.prisma.orderAllocation.findMany({
        where: { deliveredAt: { not: null }, payoutSettledAt: null },
        select: {
          id: true,
          deliveredAt: true,
          masterOrder: { select: { supplierLegalNameSnapshot: true } },
        },
        // Oldest first, so the ceiling cuts the newest — see
        // MAX_CASES_PER_SOURCE.
        orderBy: [{ deliveredAt: "asc" }, { id: "asc" }],
        take: MAX_CASES_PER_SOURCE,
      }),
      this.prisma.$queryRaw<
        { checkout_session_id: string; first_failure: Date }[]
      >`
          SELECT checkout_session_id, MIN(created_at) AS first_failure
          FROM payment_attempts
          WHERE status = 'FAILED'
          GROUP BY checkout_session_id
          HAVING COUNT(*) >= 3
          ORDER BY first_failure ASC
          LIMIT ${MAX_CASES_PER_SOURCE}
        `,
      this.prisma.dispute.findMany({
        where: { status: { notIn: [...RESOLVED_DISPUTE_STATUSES] as never } },
        select: { id: true, openedAt: true, orderAllocationId: true },
        orderBy: [{ openedAt: "asc" }, { id: "asc" }],
        take: MAX_CASES_PER_SOURCE,
      }),
      // ONE CASE PER SUPPLIER, AND ONLY ONE THAT ASKED.
      //
      // «في قسم المتابعة يطلع لي صفّين: صف توثيق مورد وصف توثيق
      //  حساب بنكي، وأنا أحتاج واحد فقط لأن المعلومات موجودة.»
      //
      // TWO THINGS WERE WRONG HERE, and this fixes both.
      //
      // THE BANK ROW WAS A QUEUE FOR A DECISION THAT NO LONGER
      // EXISTS. An account has not been approved on its own since
      // the review became one request over the whole record — so
      // the row pointed at a read-only screen, beside the supplier
      // row for the same company, carrying a HIGHER priority than
      // the request it was part of.
      //
      // AND THE SUPPLIER ROW READ THE COMPANY'S STATUS, which every
      // supplier carries from the moment it registers. So the board
      // listed every supplier that ever signed up and never asked
      // for anything — work nobody submitted, next to work somebody
      // did. It reads the OPEN REQUEST now, which is the thing an
      // administrator can actually decide.
      this.prisma.supplierVerificationRequest.findMany({
        where: { status: SupplierVerificationRequestStatus.UNDER_REVIEW },
        select: {
          id: true,
          createdAt: true,
          companyId: true,
          company: { select: { legalName: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_CASES_PER_SOURCE,
      }),
    ]);

    return [
      ...settlements.map((row) => ({
        kind: FollowUpCaseKind.SETTLEMENT_OVERDUE,
        caseRef: row.id,
        priority: "CRITICAL" as const,
        subject:
          row.masterOrder?.supplierLegalNameSnapshot ?? row.id.slice(0, 8),
        since: row.deliveredAt!,
        actionHref: `/admin/settlements?allocationId=${row.id}`,
      })),
      ...repeatedFailures.map((row) => ({
        kind: FollowUpCaseKind.PAYMENT_REPEATEDLY_FAILED,
        caseRef: row.checkout_session_id,
        priority: "CRITICAL" as const,
        subject: `CHK-${row.checkout_session_id.slice(0, 8).toUpperCase()}`,
        since: row.first_failure,
        actionHref: `/admin/orders?stage=troubled`,
      })),
      ...disputes.map((row) => ({
        kind: FollowUpCaseKind.DISPUTE_OPEN,
        caseRef: row.id,
        priority: "OVERDUE" as const,
        subject: `DSP-${row.id.slice(0, 8).toUpperCase()}`,
        since: row.openedAt,
        actionHref: `/admin/disputes/${row.id}`,
      })),
      ...suppliers.map((row) => ({
        kind: FollowUpCaseKind.SUPPLIER_VERIFICATION,
        // THE COMPANY, not the request: an assignment survives a
        // request being returned and sent again, which is one case
        // being worked on and not two.
        caseRef: row.companyId,
        priority: "REVIEW" as const,
        subject: row.company.legalName,
        since: row.createdAt,
        actionHref: `/admin/companies/${row.companyId}`,
      })),
      // NO PRODUCT REVIEW CASES, for the same reason the dashboard row
      // is gone: a supplier publishes directly, so PENDING_REVIEW is a
      // state nothing reaches. The enum member survives, so historical
      // rows and the shared contract are untouched.
      //
      // AND NO BANK ACCOUNT CASES, for the reason written above the
      // query. `BANK_ACCOUNT_REVIEW` survives in the enum on the same
      // terms: assignments recorded against it stay in the table and
      // stay readable, they simply no longer appear as work.
    ];
  }

  // ----- the two things an administrator may change --------------------

  /**
   * Puts a case on somebody, or takes it off.
   *
   * AN UPSERT ON THE UNIQUE KEY, so two administrators pressing at once
   * produce one row rather than a duplicate the list would show twice.
   * The previous owner is read INSIDE the transaction and recorded, so
   * an overwrite is visible in the trail rather than silent.
   */
  async assign(
    kind: FollowUpCaseKind,
    caseRef: string,
    assigneeId: string | null,
    ctx: Ctx,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (assigneeId) {
        const admin = await tx.adminUser.findUnique({
          where: { id: assigneeId },
          select: { id: true, status: true },
        });
        if (!admin || admin.status !== "ACTIVE") {
          throw new NotFoundException("That administrator is not available");
        }
      }

      const before = await tx.followUpAssignment.findUnique({
        where: { caseKind_caseRef: { caseKind: kind, caseRef } },
        select: { assigneeId: true, inProgress: true },
      });

      const row = await tx.followUpAssignment.upsert({
        where: { caseKind_caseRef: { caseKind: kind, caseRef } },
        create: { caseKind: kind, caseRef, assigneeId, updatedBy: ctx.actorId },
        update: { assigneeId, updatedBy: ctx.actorId },
        select: { id: true, assigneeId: true, inProgress: true },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "FOLLOW_UP_ASSIGNED",
          entityType: "follow_up_assignment",
          entityId: row.id,
          // WHO HAD IT, AND WHO HAS IT NOW. An overwrite that left no
          // trace is how two people end up believing they own a case.
          before: {
            assigneeId: before?.assigneeId ?? null,
            caseKind: kind,
            caseRef,
          },
          after: { assigneeId, caseKind: kind, caseRef },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { caseKind: kind, caseRef, assigneeId: row.assigneeId };
    });
  }

  /**
   * Marks a case as being worked on, or no longer.
   *
   * THIS DOES NOT CLOSE ANYTHING. The case stays in the list until its
   * cause is resolved in its own table — there is no field here that
   * could remove it.
   */
  async setInProgress(
    kind: FollowUpCaseKind,
    caseRef: string,
    inProgress: boolean,
    ctx: Ctx,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.followUpAssignment.findUnique({
        where: { caseKind_caseRef: { caseKind: kind, caseRef } },
        select: { inProgress: true },
      });

      const row = await tx.followUpAssignment.upsert({
        where: { caseKind_caseRef: { caseKind: kind, caseRef } },
        create: { caseKind: kind, caseRef, inProgress, updatedBy: ctx.actorId },
        update: { inProgress, updatedBy: ctx.actorId },
        select: { id: true, inProgress: true },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "FOLLOW_UP_PROGRESS_CHANGED",
          entityType: "follow_up_assignment",
          entityId: row.id,
          before: {
            inProgress: String(before?.inProgress ?? false),
            caseKind: kind,
            caseRef,
          },
          after: { inProgress: String(inProgress), caseKind: kind, caseRef },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { caseKind: kind, caseRef, inProgress: row.inProgress };
    });
  }
}
