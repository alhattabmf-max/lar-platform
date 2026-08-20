import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import { isValidOpportunityTransition, type OpportunityStatus } from "@platform/domain";
import { PrismaService } from "../../database/prisma.service";
import { BusinessException } from "../../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { ListAdminOpportunitiesQueryDto } from "./dto/list-admin-opportunities-query.dto";
import { releaseActiveLocksForOpportunityTx } from "../../checkout/checkout-lock-release.util";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AdminOpportunityView {
  id: string;
  companyId: string;
  productId: string;
  fulfillmentLocationId: string;
  targetQuantity: number;
  fundedQuantity: number;
  unitPriceAmount: number;
  currency: string;
  startAt: Date;
  endAt: Date;
  expectedPreparationDays: number;
  descriptionAr: string | null;
  descriptionEn: string | null;
  status: OpportunityStatus;
  firstActivatedAt: Date | null;
  extendedAt: Date | null;
  pausedAt: Date | null;
  pauseReason: string | null;
  cancelReason: string | null;
  reasonCode: string | null;
  reasonDetails: string | null;
  blockedAt: Date | null;
  fulfillmentCityNameAr: string | null;
  fulfillmentCityNameEn: string | null;
  fulfillmentRegionNameAr: string | null;
  fulfillmentRegionNameEn: string | null;
  taxRatePercent: number | null;
  unitPriceExclTaxAmount: number | null;
  unitTaxAmount: number | null;
  totalValueInclTaxAmount: number | null;
  sharePercentage: number | null;
  shareQuantity: number | null;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const ADMIN_SELECT = {
  id: true,
  companyId: true,
  productId: true,
  fulfillmentLocationId: true,
  targetQuantity: true,
  fundedQuantity: true,
  unitPriceAmount: true,
  currency: true,
  startAt: true,
  endAt: true,
  expectedPreparationDays: true,
  descriptionAr: true,
  descriptionEn: true,
  status: true,
  firstActivatedAt: true,
  extendedAt: true,
  pausedAt: true,
  pauseReason: true,
  cancelReason: true,
  reasonCode: true,
  reasonDetails: true,
  blockedAt: true,
  fulfillmentCityNameAr: true,
  fulfillmentCityNameEn: true,
  fulfillmentRegionNameAr: true,
  fulfillmentRegionNameEn: true,
  taxRatePercent: true,
  unitPriceExclTaxAmount: true,
  unitTaxAmount: true,
  totalValueInclTaxAmount: true,
  shareBasisPoints: true,
  shareQuantity: true,
  salesUnitNameAr: true,
  salesUnitNameEn: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OpportunitySelect;

type AdminRow = Prisma.OpportunityGetPayload<{ select: typeof ADMIN_SELECT }>;

/**
 * Admin never selects fulfillmentLocationId's target row, city/region
 * internal ids, productApprovalSnapshotId, or shareTierPolicyVersionId
 * — this select list is the enforcement point, not just the response
 * mapper: those fields are never even fetched from the database here.
 * sharePercentage is derived from shareBasisPoints at mapping time —
 * the raw basis-points value itself is not part of AdminOpportunityView.
 */
function toAdminOpportunityView(row: AdminRow): AdminOpportunityView {
  return {
    id: row.id,
    companyId: row.companyId,
    productId: row.productId,
    fulfillmentLocationId: row.fulfillmentLocationId,
    targetQuantity: row.targetQuantity,
    fundedQuantity: row.fundedQuantity,
    unitPriceAmount: row.unitPriceAmount.toNumber(),
    currency: row.currency,
    startAt: row.startAt,
    endAt: row.endAt,
    expectedPreparationDays: row.expectedPreparationDays,
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    status: row.status,
    firstActivatedAt: row.firstActivatedAt,
    extendedAt: row.extendedAt,
    pausedAt: row.pausedAt,
    pauseReason: row.pauseReason,
    cancelReason: row.cancelReason,
    reasonCode: row.reasonCode,
    reasonDetails: row.reasonDetails,
    blockedAt: row.blockedAt,
    fulfillmentCityNameAr: row.fulfillmentCityNameAr,
    fulfillmentCityNameEn: row.fulfillmentCityNameEn,
    fulfillmentRegionNameAr: row.fulfillmentRegionNameAr,
    fulfillmentRegionNameEn: row.fulfillmentRegionNameEn,
    taxRatePercent: row.taxRatePercent?.toNumber() ?? null,
    unitPriceExclTaxAmount: row.unitPriceExclTaxAmount?.toNumber() ?? null,
    unitTaxAmount: row.unitTaxAmount?.toNumber() ?? null,
    totalValueInclTaxAmount: row.totalValueInclTaxAmount?.toNumber() ?? null,
    sharePercentage: row.shareBasisPoints !== null ? row.shareBasisPoints / 100 : null,
    shareQuantity: row.shareQuantity,
    salesUnitNameAr: row.salesUnitNameAr,
    salesUnitNameEn: row.salesUnitNameEn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Monitor-only, matching "Self-Service & Automation First": no
 * create/update method exists anywhere in this service. Price,
 * target quantity, share fields, and every snapshot are therefore
 * structurally unreachable from Admin — not merely blocked by a
 * check, there is simply no code path that could touch them.
 *
 * Every transition here is validated against the SAME
 * OPPORTUNITY_TRANSITIONS table opportunities.service.ts and the
 * lifecycle sweep already use — never a hand-picked status list.
 * ACTION_REQUIRED has no outgoing admin action at all: the table only
 * allows ACTION_REQUIRED -> SCHEDULED/ACTIVE, and that path is
 * exclusively the supplier's publish()/republish — Admin has no way
 * to "fix" a blocked opportunity on the supplier's behalf.
 */
@Injectable()
export class AdminOpportunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAdminOpportunitiesQueryDto): Promise<PaginatedResult<AdminOpportunityView>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.OpportunityWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.companyId) where.companyId = query.companyId;
    if (query.productId) where.productId = query.productId;

    const [rows, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        select: ADMIN_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    return { items: rows.map(toAdminOpportunityView), page, pageSize, total };
  }

  async getById(id: string): Promise<AdminOpportunityView> {
    const row = await this.prisma.opportunity.findUnique({ where: { id }, select: ADMIN_SELECT });
    if (!row) throw new NotFoundException("Opportunity not found");
    return toAdminOpportunityView(row);
  }

  /**
   * ACTIVE -> PAUSED, and only from ACTIVE (the only source listed
   * for PAUSED in the table). Reason is mandatory. Stops NEW sales
   * only — never touches fundedQuantity, never cancels or refunds
   * any already-paid order (see the file-level contract in
   * @platform/opportunity-lifecycle's sweep.ts, which this endpoint's
   * OPPORTUNITY_PAUSED event is bound by identically).
   *
   * The claim itself is a single atomic UPDATE ... WHERE status =
   * 'ACTIVE' ... RETURNING statement — never a SELECT-then-write. Two
   * concurrent pause() calls on the same row will have exactly one
   * UPDATE match (the other's WHERE clause finds nothing once the
   * first has committed its status change), so only one can ever
   * succeed, with no window for both to read "ACTIVE" before either
   * writes.
   */
  async pause(id: string, reason: string, ctx: ActorContext): Promise<AdminOpportunityView> {
    const existing = await this.requireExisting(id);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'PAUSED', paused_at = now(), pause_reason = ${reason}, updated_at = now()
        WHERE id = ${id}::uuid AND status = 'ACTIVE'
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "This opportunity is no longer ACTIVE and cannot be paused"
        );
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          companyId: existing.companyId,
          action: "OPPORTUNITY_PAUSED",
          entityType: "opportunity",
          entityId: id,
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "OPPORTUNITY_PAUSED", payload: { opportunityId: id } as Prisma.InputJsonValue },
      });

      const updated = await tx.opportunity.findUniqueOrThrow({ where: { id }, select: ADMIN_SELECT });
      return toAdminOpportunityView(updated);
    });
  }

  /**
   * PAUSED -> ACTIVE, and ONLY from PAUSED — the WHERE clause below
   * checks status = 'PAUSED' explicitly (never the generic "does
   * anything lead to ACTIVE" check, since DRAFT/SCHEDULED/
   * ACTION_REQUIRED -> ACTIVE via publish() and ACTIVE -> ACTIVE via
   * extend() are both unrelated to "resume").
   *
   * Self-corrects the temporal state first, atomically, inside the
   * same transaction: if end_at has already passed (the worker just
   * hasn't caught up to it yet), the atomic claim below is scoped to
   * `AND end_at > now()`, so a stale PAUSED row past its end date
   * simply fails to match — it is then transitioned to EXPIRED
   * (itself an atomic, WHERE-guarded claim) instead of being resumed,
   * exactly like OpportunitiesService.update() re-checks start_at
   * against "now" before allowing a SCHEDULED edit.
   */
  async resume(id: string, ctx: ActorContext): Promise<AdminOpportunityView> {
    const existing = await this.requireExisting(id);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const resumed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'ACTIVE', paused_at = NULL, pause_reason = NULL, updated_at = now()
        WHERE id = ${id}::uuid AND status = 'PAUSED' AND end_at > now()
        RETURNING id
      `;

      if (resumed.length > 0) {
        await tx.auditLog.create({
          data: {
            actorType: AuditActorType.ADMIN,
            actorId: ctx.actorId,
            companyId: existing.companyId,
            action: "OPPORTUNITY_RESUMED",
            entityType: "opportunity",
            entityId: id,
            reason: existing.pauseReason ? `Previously paused for: ${existing.pauseReason}` : undefined,
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        await tx.outboxEvent.create({
          data: { eventType: "OPPORTUNITY_RESUMED", payload: { opportunityId: id } as Prisma.InputJsonValue },
        });
        return "RESUMED" as const;
      }

      // Not resumable as-is — atomically attempt the specific
      // self-correction: still PAUSED, but its end_at has passed.
      // This is a RETURN, deliberately not a throw: throwing inside
      // $transaction() rolls back everything in it, including this
      // EXPIRED write we explicitly want to keep — the caller-facing
      // error is raised separately, after this transaction commits.
      const expired = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'EXPIRED', updated_at = now()
        WHERE id = ${id}::uuid AND status = 'PAUSED' AND end_at <= now()
        RETURNING id
      `;
      if (expired.length > 0) {
        await tx.auditLog.create({
          data: {
            actorType: AuditActorType.SYSTEM,
            companyId: existing.companyId,
            action: "OPPORTUNITY_EXPIRED",
            entityType: "opportunity",
            entityId: id,
            reason: "Self-corrected on resume attempt: end_at had already passed",
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        await tx.outboxEvent.create({
          data: { eventType: "OPPORTUNITY_EXPIRED", payload: { opportunityId: id } as Prisma.InputJsonValue },
        });
        return "SELF_CORRECTED_TO_EXPIRED" as const;
      }

      // Neither claim matched — the row was not PAUSED at all (a
      // concurrent caller already changed it, or it never was).
      return "NOT_PAUSED" as const;
    });

    if (outcome === "SELF_CORRECTED_TO_EXPIRED") {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        "This opportunity has already ended and cannot be resumed — it has been marked EXPIRED"
      );
    }
    if (outcome === "NOT_PAUSED") {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "This opportunity is not PAUSED");
    }

    const updated = await this.prisma.opportunity.findUniqueOrThrow({ where: { id }, select: ADMIN_SELECT });
    return toAdminOpportunityView(updated);
  }

  /**
   * Reachable per the transitions table from DRAFT, SCHEDULED,
   * ACTIVE, or PAUSED — deliberately NOT from ACTION_REQUIRED (not in
   * the table), so Admin can never terminate a blocked opportunity as
   * a substitute for the supplier fixing and republishing it. Reason
   * is mandatory. Atomic claim: the UPDATE's WHERE clause re-checks
   * the transitions table for whichever status the row ACTUALLY has
   * at write time, via an explicit IN-list built from the table.
   *
   * Cancelling closes the opportunity to NEW sales permanently — it
   * never cancels or refunds any already-paid order and never
   * reverses fundedQuantity; any such order is handled exclusively
   * through its own independent order lifecycle (Phase 7).
   */
  async cancel(id: string, reason: string, ctx: ActorContext): Promise<AdminOpportunityView> {
    const existing = await this.requireExisting(id);

    const cancellableFrom = (
      ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED"] as const
    ).filter((status) => isValidOpportunityTransition(status, "CANCELLED"));
    const cancellableFromSql = Prisma.join(cancellableFrom.map((s) => Prisma.sql`${s}::"OpportunityStatus"`));

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'CANCELLED', cancel_reason = ${reason}, updated_at = now()
        WHERE id = ${id}::uuid AND status IN (${cancellableFromSql})
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "This opportunity cannot be cancelled from its current status"
        );
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          companyId: existing.companyId,
          action: "OPPORTUNITY_CANCELLED",
          entityType: "opportunity",
          entityId: id,
          reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "OPPORTUNITY_CANCELLED", payload: { opportunityId: id } as Prisma.InputJsonValue },
      });

      await releaseActiveLocksForOpportunityTx(tx, id);

      const updated = await tx.opportunity.findUniqueOrThrow({ where: { id }, select: ADMIN_SELECT });
      return toAdminOpportunityView(updated);
    });
  }

  private async requireExisting(id: string) {
    const row = await this.prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, companyId: true, status: true, pauseReason: true },
    });
    if (!row) throw new NotFoundException("Opportunity not found");
    return row;
  }
}
