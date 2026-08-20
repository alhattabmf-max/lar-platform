import { Injectable, NotFoundException } from "@nestjs/common";
import { AccountType, AuditActorType, Prisma, ProductReportStatus } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { CreateProductReportDto } from "./dto/create-product-report.dto";

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface AdminActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const REPORT_SELECT = {
  id: true,
  productId: true,
  reporterCompanyId: true,
  reportedProductApprovalSnapshotId: true,
  reasonCode: true,
  reasonDetails: true,
  status: true,
  adminDecisionNote: true,
  resolvedByAdminId: true,
  createdAt: true,
  resolvedAt: true,
} satisfies Prisma.ProductReportSelect;

const ADMIN_REPORT_SELECT = {
  ...REPORT_SELECT,
  evidence: { select: { id: true, objectKey: true, contentType: true, sizeBytes: true, createdAt: true } },
} satisfies Prisma.ProductReportSelect;

/**
 * Filing a report NEVER hides or pauses the product by itself — that
 * is exclusively AdminProductsService.suspend()/close()'s job, called
 * independently by an admin after triage. This service only manages
 * the report's own lifecycle (OPEN -> CLARIFICATION_REQUESTED /
 * DISMISSED / RESOLVED).
 */
@Injectable()
export class ProductReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async create(dto: CreateProductReportDto, ctx: ActorContext) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    if (company.accountType !== AccountType.TRADER) {
      throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "Only trader accounts can file product reports");
    }

    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException("Product not found");

    if (product.companyId === ctx.companyId) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "You cannot report your own product");
    }

    const latestSnapshot = await this.prisma.productApprovalSnapshot.findFirst({
      where: { productId: dto.productId },
      orderBy: { approvedAt: "desc" },
    });
    if (!latestSnapshot) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "This product has never been approved and cannot be reported"
      );
    }

    try {
      const report = await this.prisma.productReport.create({
        data: {
          productId: dto.productId,
          reporterCompanyId: ctx.companyId,
          reportedProductApprovalSnapshotId: latestSnapshot.id,
          reasonCode: dto.reasonCode,
          reasonDetails: dto.reasonDetails,
          evidence: dto.evidence
            ? {
                create: dto.evidence.map((e) => ({
                  objectKey: e.objectKey,
                  contentType: e.contentType,
                  sizeBytes: e.sizeBytes,
                })),
              }
            : undefined,
        },
        select: REPORT_SELECT,
      });

      await this.audit.log({
        actorType: AuditActorType.USER,
        actorId: ctx.userId,
        companyId: ctx.companyId,
        action: "PRODUCT_REPORT_FILED",
        entityType: "product_report",
        entityId: report.id,
        after: { productId: dto.productId, reasonCode: dto.reasonCode },
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return report;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "You already have an open report on this product");
      }
      throw err;
    }
  }

  async listMine(companyId: string) {
    return this.prisma.productReport.findMany({
      where: { reporterCompanyId: companyId },
      select: REPORT_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async listForAdmin(status?: ProductReportStatus) {
    return this.prisma.productReport.findMany({
      where: status ? { status } : {},
      select: ADMIN_REPORT_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async getForAdmin(id: string) {
    const report = await this.prisma.productReport.findUnique({ where: { id }, select: ADMIN_REPORT_SELECT });
    if (!report) throw new NotFoundException("Report not found");
    return report;
  }

  async requestClarification(id: string, note: string | undefined, adminUserId: string, ctx: AdminActorContext) {
    return this.transitionAtomic(id, ["OPEN"], "CLARIFICATION_REQUESTED", note, adminUserId, ctx);
  }

  async dismiss(id: string, note: string | undefined, adminUserId: string, ctx: AdminActorContext) {
    return this.transitionAtomic(id, ["OPEN", "CLARIFICATION_REQUESTED"], "DISMISSED", note, adminUserId, ctx);
  }

  async resolve(id: string, note: string | undefined, adminUserId: string, ctx: AdminActorContext) {
    return this.transitionAtomic(id, ["OPEN", "CLARIFICATION_REQUESTED"], "RESOLVED", note, adminUserId, ctx);
  }

  private async transitionAtomic(
    id: string,
    fromStatuses: ProductReportStatus[],
    toStatus: ProductReportStatus,
    note: string | undefined,
    adminUserId: string,
    ctx: AdminActorContext
  ) {
    return this.prisma.$transaction(async (tx) => {
      const fromSql = Prisma.join(fromStatuses.map((s) => Prisma.sql`${s}::"ProductReportStatus"`));
      const isTerminal = toStatus === "DISMISSED" || toStatus === "RESOLVED";
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE product_reports
        SET status = ${toStatus}::"ProductReportStatus",
            admin_decision_note = ${note ?? null},
            resolved_by_admin_id = ${isTerminal ? adminUserId : null}::uuid,
            resolved_at = ${isTerminal ? new Date() : null}
        WHERE id = ${id}::uuid AND status IN (${fromSql})
        RETURNING id
      `;
      if (claimed.length === 0) {
        const exists = await tx.productReport.findUnique({ where: { id } });
        if (!exists) throw new NotFoundException("Report not found");
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          `Cannot transition a report with status ${exists.status} to ${toStatus}`
        );
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: adminUserId,
          action: `PRODUCT_REPORT_${toStatus}`,
          entityType: "product_report",
          entityId: id,
          afterData: { status: toStatus } as Prisma.InputJsonValue,
          reason: note,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: `PRODUCT_REPORT_${toStatus}`, payload: { reportId: id } as Prisma.InputJsonValue },
      });

      return tx.productReport.findUniqueOrThrow({ where: { id }, select: ADMIN_REPORT_SELECT });
    });
  }
}
