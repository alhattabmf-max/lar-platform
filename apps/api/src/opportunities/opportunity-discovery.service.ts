import { Injectable } from "@nestjs/common";
import { OpportunityStatus, type Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { OpportunitySettingsService } from "../settings/opportunity-settings.service";
import type { ListOpportunitiesQueryDto } from "./dto/list-opportunities-query.dto";

interface SnapshotProductData {
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PublicOpportunityView {
  id: string;
  productNameAr: string;
  productNameEn: string;
  fulfillmentCityNameAr: string;
  fulfillmentCityNameEn: string;
  status: OpportunityStatus;
}

export interface TraderOpportunityView {
  id: string;
  productNameAr: string;
  productNameEn: string;
  productDescriptionAr: string | null;
  productDescriptionEn: string | null;
  unitPriceAmount: number;
  currency: string;
  targetQuantity: number;
  fundedQuantity: number;
  /** Percentage of the supply cap (targetQuantity) sold so far — "how much has sold", not "how close to a required goal". targetQuantity is a supply cap the supplier is willing to sell, not a collective funding target. */
  progressPercentage: number;
  /** Minimum/increment purchase unit — the single source of truth, replacing the old minPurchaseQuantity/maxPurchaseQuantity. */
  shareQuantity: number;
  /** A human percentage (e.g. 10, 2.5) — never the raw basis points or the policy version id. */
  sharePercentage: number;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  fulfillmentCityNameAr: string;
  fulfillmentCityNameEn: string;
  fulfillmentRegionNameAr: string;
  fulfillmentRegionNameEn: string;
  startAt: Date;
  endAt: Date;
  expectedPreparationDays: number;
  status: OpportunityStatus;
}

const PUBLIC_SELECT = {
  id: true,
  fulfillmentCityNameAr: true,
  fulfillmentCityNameEn: true,
  status: true,
  productApprovalSnapshot: { select: { snapshot: true } },
} satisfies Prisma.OpportunitySelect;

const TRADER_SELECT = {
  id: true,
  unitPriceAmount: true,
  currency: true,
  targetQuantity: true,
  fundedQuantity: true,
  shareQuantity: true,
  shareBasisPoints: true,
  salesUnitNameAr: true,
  salesUnitNameEn: true,
  fulfillmentCityNameAr: true,
  fulfillmentCityNameEn: true,
  fulfillmentRegionNameAr: true,
  fulfillmentRegionNameEn: true,
  startAt: true,
  endAt: true,
  expectedPreparationDays: true,
  status: true,
  productApprovalSnapshot: { select: { snapshot: true } },
} satisfies Prisma.OpportunitySelect;

type PublicRow = Prisma.OpportunityGetPayload<{ select: typeof PUBLIC_SELECT }>;
type TraderRow = Prisma.OpportunityGetPayload<{ select: typeof TRADER_SELECT }>;

/**
 * Never exposes: reasonCode, reasonDetails, blockedAt, fulfillmentLocationId,
 * fulfillmentCityId (the internal FK id — only the snapshotted names),
 * companyId, any bank/financial-readiness data, or any raw Product row
 * (all commercial product data comes exclusively from the frozen
 * ProductApprovalSnapshot.snapshot JSON captured at publish time).
 */
@Injectable()
export class OpportunityDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunitySettings: OpportunitySettingsService
  ) {}

  async listPublic(query: ListOpportunitiesQueryDto): Promise<PaginatedResult<PublicOpportunityView>> {
    const { where, page, pageSize } = await this.buildQuery(query);

    const [rows, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        select: PUBLIC_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    return { items: rows.map((r) => this.toPublicView(r)), page, pageSize, total };
  }

  async getPublicDetail(id: string): Promise<PublicOpportunityView | null> {
    const statuses = await this.resolveVisibleStatuses();
    const row = await this.prisma.opportunity.findFirst({
      where: { id, status: { in: statuses } },
      select: PUBLIC_SELECT,
    });
    return row ? this.toPublicView(row) : null;
  }

  async listForTrader(query: ListOpportunitiesQueryDto): Promise<PaginatedResult<TraderOpportunityView>> {
    const { where, page, pageSize } = await this.buildQuery(query);

    const [rows, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        select: TRADER_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    return { items: rows.map((r) => this.toTraderView(r)), page, pageSize, total };
  }

  async getTraderDetail(id: string): Promise<TraderOpportunityView | null> {
    const statuses = await this.resolveVisibleStatuses();
    const row = await this.prisma.opportunity.findFirst({
      where: { id, status: { in: statuses } },
      select: TRADER_SELECT,
    });
    return row ? this.toTraderView(row) : null;
  }

  private async resolveVisibleStatuses(): Promise<OpportunityStatus[]> {
    const settings = await this.opportunitySettings.getConfig();
    const statuses: OpportunityStatus[] = [OpportunityStatus.ACTIVE];
    if (settings.showScheduledPubliclyEnabled) {
      statuses.push(OpportunityStatus.SCHEDULED);
    }
    return statuses;
  }

  private async buildQuery(
    query: ListOpportunitiesQueryDto
  ): Promise<{ where: Prisma.OpportunityWhereInput; page: number; pageSize: number }> {
    const statuses = await this.resolveVisibleStatuses();
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.OpportunityWhereInput = { status: { in: statuses } };
    if (query.cityId) where.fulfillmentCityId = query.cityId;
    if (query.productId) where.productId = query.productId;
    if (query.taxonomyNodeId) {
      // Filters against the FROZEN snapshot's own taxonomyNodeId (captured
      // at product-approval time — see admin-products.service.ts), never
      // against the live Product row. A category change on the live
      // product after an opportunity was published must never affect
      // that opportunity's filterability, exactly as it must never
      // affect what is displayed for it.
      where.productApprovalSnapshot = {
        is: { snapshot: { path: ["taxonomyNodeId"], equals: query.taxonomyNodeId } },
      };
    }

    return { where, page, pageSize };
  }

  private parseSnapshot(raw: Prisma.JsonValue): SnapshotProductData {
    const v = raw as Record<string, unknown>;
    return {
      nameAr: typeof v.nameAr === "string" ? v.nameAr : "",
      nameEn: typeof v.nameEn === "string" ? v.nameEn : "",
      descriptionAr: typeof v.descriptionAr === "string" ? v.descriptionAr : null,
      descriptionEn: typeof v.descriptionEn === "string" ? v.descriptionEn : null,
    };
  }

  private toPublicView(row: PublicRow): PublicOpportunityView {
    const product = this.parseSnapshot(row.productApprovalSnapshot?.snapshot ?? {});
    return {
      id: row.id,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      fulfillmentCityNameAr: row.fulfillmentCityNameAr ?? "",
      fulfillmentCityNameEn: row.fulfillmentCityNameEn ?? "",
      status: row.status,
    };
  }

  private toTraderView(row: TraderRow): TraderOpportunityView {
    const product = this.parseSnapshot(row.productApprovalSnapshot?.snapshot ?? {});
    const targetQuantity = row.targetQuantity;
    const fundedQuantity = row.fundedQuantity;
    // Percentage of the supply cap sold so far — not "progress toward
    // completion". targetQuantity is a cap, not a collective goal.
    const progressPercentage = targetQuantity > 0 ? (fundedQuantity / targetQuantity) * 100 : 0;
    // Human percentage derived from basis points (e.g. 1000 -> 10) —
    // the raw basis points value and the policy version id are never
    // included in this view.
    const sharePercentage = (row.shareBasisPoints ?? 0) / 100;

    return {
      id: row.id,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      productDescriptionAr: product.descriptionAr,
      productDescriptionEn: product.descriptionEn,
      unitPriceAmount: row.unitPriceAmount.toNumber(),
      currency: row.currency,
      targetQuantity,
      fundedQuantity,
      progressPercentage,
      shareQuantity: row.shareQuantity ?? 0,
      sharePercentage,
      salesUnitNameAr: row.salesUnitNameAr ?? "",
      salesUnitNameEn: row.salesUnitNameEn ?? "",
      fulfillmentCityNameAr: row.fulfillmentCityNameAr ?? "",
      fulfillmentCityNameEn: row.fulfillmentCityNameEn ?? "",
      fulfillmentRegionNameAr: row.fulfillmentRegionNameAr ?? "",
      fulfillmentRegionNameEn: row.fulfillmentRegionNameEn ?? "",
      startAt: row.startAt,
      endAt: row.endAt,
      expectedPreparationDays: row.expectedPreparationDays,
      status: row.status,
    };
  }
}
