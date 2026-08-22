import { Injectable } from "@nestjs/common";
import { OpportunityStatus, type Prisma } from "@prisma/client";
import { DEFAULT_OPPORTUNITY_SORT, type OpportunitySort } from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { OpportunitySettingsService } from "../settings/opportunity-settings.service";
import { selectMainMedia } from "./snapshot-media.util";
import type { ListOpportunitiesQueryDto } from "./dto/list-opportunities-query.dto";

/**
 * Asserts a column that is nullable in the schema but guaranteed
 * populated for any publicly visible opportunity.
 *
 * Throwing beats coercing to "": a blank city name reaches the user as
 * a silent rendering defect, whereas this fails loudly with the
 * opportunity id and the field, which is what an on-call engineer
 * needs.
 */
function assertPresent<T>(value: T | null, opportunityId: string, field: string): T {
  if (value === null) {
    throw new Error(
      `Opportunity ${opportunityId} is publicly visible but has a null ${field} — this violates the publish-time invariant`
    );
  }
  return value;
}

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

/**
 * The ANONYMOUS view.
 *
 * Carries no price, no quantity, no share size and no purchase step.
 * That boundary is load-bearing, not incidental: commercial terms stay
 * behind RequireTraderGuard, and adding a field here moves the
 * public/authenticated line. `salesUnitName*` is included because a
 * selling unit describes the product rather than its terms — it
 * reveals no price, quantity, or margin.
 */
export interface PublicOpportunityView {
  id: string;
  productNameAr: string;
  productNameEn: string;
  /** Route, never a storage key. Null for snapshots with no usable media. */
  imageUrl: string | null;
  thumbnailUrl: string | null;
  fulfillmentCityNameAr: string;
  fulfillmentCityNameEn: string;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  endAt: Date;
  status: OpportunityStatus;
}

/**
 * The anonymous DETAIL view: the list item plus descriptive context.
 *
 * Adds description, fulfilment region and the window open. It adds NO
 * commercial term — no price, no quantity, no share size, no purchase
 * step, and notably no `expectedPreparationDays`, which is a supply
 * commitment and belongs with the terms.
 */
export interface PublicOpportunityDetailView extends PublicOpportunityView {
  productDescriptionAr: string | null;
  productDescriptionEn: string | null;
  fulfillmentRegionNameAr: string | null;
  fulfillmentRegionNameEn: string | null;
  startAt: Date;
}

/**
 * Commercial terms, trader-only.
 *
 * Mirrors `TraderOpportunityTerms` in @platform/types. Every money
 * field is a fixed-scale DECIMAL STRING: these come from
 * `Decimal(12,2)` columns and a JSON number cannot represent 125.50
 * exactly, so serialising through one changes a figure that gets
 * reconciled against a bank statement.
 */
export interface TraderOpportunityTermsView {
  /** Tax-INCLUSIVE unit price, from opportunities.unit_price_amount. */
  unitPriceInclTaxAmount: string;
  currency: string;
  targetQuantity: number;
  fundedQuantity: number;
  /**
   * targetQuantity − fundedQuantity: an arithmetic difference, NOT a
   * guarantee of what can be purchased.
   *
   * What a later cancellation or refund does to sellable quantity is an
   * explicitly deferred decision, so this must never be presented as
   * available-to-buy, and Checkout must never treat it as a
   * reservation. Checkout's own lock is the only authority.
   *
   * Clamped at zero defensively — a negative figure would mean
   * fundedQuantity had exceeded the cap, which is a data problem to
   * find rather than one to render as "-3 available".
   */
  unsoldQuantity: number;
  /** Share of the supply cap SOLD so far — not progress toward a goal. */
  progressPercentage: number;
  /** Minimum purchase AND the increment step — one value serves both. */
  shareQuantity: number;
  /** Human percentage (e.g. 10, 2.5) — never raw basis points. */
  sharePercentage: number;
}

/**
 * The trader LIST item: the public item plus commercial terms.
 *
 * COMPOSED from `PublicOpportunityView` rather than restating its
 * fields. Restating is how the two lists drift — a field added to one
 * and forgotten on the other, or a name differing by a letter, which no
 * compiler catches because the types would be unrelated.
 *
 * Composition also means the trader list gets the SAME image selection
 * as the public one for free: one `selectMainMedia` call site, one
 * ordering (isMain DESC, sortOrder ASC, objectKey ASC), and a route
 * rather than a storage key.
 *
 * The direction matters. Terms extend the public shape; the public
 * shape never extends terms, so no commercial field can arrive on the
 * anonymous marketplace by inheritance.
 */
export interface TraderOpportunityItemView
  extends PublicOpportunityView,
    TraderOpportunityTermsView {}

/**
 * The trader DETAIL view: the public detail plus the same terms.
 *
 * `expectedPreparationDays` is added HERE and nowhere public: it is how
 * long the supplier has to prepare after payment — a supply commitment
 * a trader needs before buying, and not a property of the product.
 */
export interface TraderOpportunityDetailView
  extends PublicOpportunityDetailView,
    TraderOpportunityTermsView {
  expectedPreparationDays: number;
}

const PUBLIC_SELECT = {
  id: true,
  fulfillmentCityNameAr: true,
  fulfillmentCityNameEn: true,
  salesUnitNameAr: true,
  salesUnitNameEn: true,
  endAt: true,
  status: true,
  productApprovalSnapshot: { select: { snapshot: true } },
} satisfies Prisma.OpportunitySelect;

const PUBLIC_DETAIL_SELECT = {
  ...PUBLIC_SELECT,
  fulfillmentRegionNameAr: true,
  fulfillmentRegionNameEn: true,
  startAt: true,
} satisfies Prisma.OpportunitySelect;

/**
 * Sort vocabulary → concrete ordering.
 *
 * Every entry ends in `id`, and that is the point: `createdAt` and
 * `endAt` are both non-unique, and PostgreSQL gives no ordering
 * guarantee between rows that tie. Under LIMIT/OFFSET pagination a tie
 * spanning a page boundary can serve the same row twice and never serve
 * another — a bug that only appears in production data and looks like
 * a phantom duplicate.
 *
 * The `id` direction is arbitrary — ids are random UUIDs, so neither
 * direction means anything — but it must be FIXED, which is why it is
 * written here once instead of at each call site.
 */
const ORDER_BY: Record<OpportunitySort, Prisma.OpportunityOrderByWithRelationInput[]> = {
  NEWEST: [{ createdAt: "desc" }, { id: "asc" }],
  ENDING_SOON: [{ endAt: "asc" }, { createdAt: "desc" }, { id: "asc" }],
};

/**
 * The columns terms are built from, on top of a public select.
 *
 * Kept separate so both trader selects add exactly the same set — and
 * so what makes a select "trader" is one named thing rather than a
 * difference someone has to diff two object literals to see.
 */
const TERMS_SELECT = {
  unitPriceAmount: true,
  currency: true,
  targetQuantity: true,
  fundedQuantity: true,
  shareQuantity: true,
  shareBasisPoints: true,
} satisfies Prisma.OpportunitySelect;

const TRADER_SELECT = {
  ...PUBLIC_SELECT,
  ...TERMS_SELECT,
} satisfies Prisma.OpportunitySelect;

const TRADER_DETAIL_SELECT = {
  ...PUBLIC_DETAIL_SELECT,
  ...TERMS_SELECT,
  expectedPreparationDays: true,
} satisfies Prisma.OpportunitySelect;

type PublicRow = Prisma.OpportunityGetPayload<{ select: typeof PUBLIC_SELECT }>;
type PublicDetailRow = Prisma.OpportunityGetPayload<{ select: typeof PUBLIC_DETAIL_SELECT }>;
type TraderRow = Prisma.OpportunityGetPayload<{ select: typeof TRADER_SELECT }>;
type TraderDetailRow = Prisma.OpportunityGetPayload<{ select: typeof TRADER_DETAIL_SELECT }>;

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
    const { where, orderBy, page, pageSize } = await this.buildQuery(query);

    const [rows, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        select: PUBLIC_SELECT,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    return { items: rows.map((r) => this.toPublicView(r)), page, pageSize, total };
  }

  async getPublicDetail(id: string): Promise<PublicOpportunityDetailView | null> {
    const statuses = await this.resolveVisibleStatuses();
    const row = await this.prisma.opportunity.findFirst({
      where: { id, status: { in: statuses } },
      select: PUBLIC_DETAIL_SELECT,
    });
    return row ? this.toPublicDetailView(row) : null;
  }

  async listForTrader(query: ListOpportunitiesQueryDto): Promise<PaginatedResult<TraderOpportunityItemView>> {
    const { where, orderBy, page, pageSize } = await this.buildQuery(query);

    const [rows, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        select: TRADER_SELECT,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    return { items: rows.map((r) => this.toTraderView(r)), page, pageSize, total };
  }

  async getTraderDetail(id: string): Promise<TraderOpportunityDetailView | null> {
    const statuses = await this.resolveVisibleStatuses();
    const row = await this.prisma.opportunity.findFirst({
      where: { id, status: { in: statuses } },
      select: TRADER_DETAIL_SELECT,
    });
    return row ? this.toTraderDetailView(row) : null;
  }

  private async resolveVisibleStatuses(): Promise<OpportunityStatus[]> {
    const settings = await this.opportunitySettings.getConfig();
    const statuses: OpportunityStatus[] = [OpportunityStatus.ACTIVE];
    if (settings.showScheduledPubliclyEnabled) {
      statuses.push(OpportunityStatus.SCHEDULED);
    }
    return statuses;
  }

  private async buildQuery(query: ListOpportunitiesQueryDto): Promise<{
    where: Prisma.OpportunityWhereInput;
    orderBy: Prisma.OpportunityOrderByWithRelationInput[];
    page: number;
    pageSize: number;
  }> {
    const statuses = await this.resolveVisibleStatuses();
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    // The wire default stays NEWEST so every caller written before
    // `sort` existed keeps its original ordering. A surface wanting
    // ending-soonest must ask for it explicitly.
    const orderBy = ORDER_BY[query.sort ?? DEFAULT_OPPORTUNITY_SORT];

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

    return { where, orderBy, page, pageSize };
  }

  /**
   * Storage keys for a publicly visible opportunity's representative
   * image, or null.
   *
   * Reuses `resolveVisibleStatuses()` — the SAME visibility rule the
   * list and detail reads use — rather than restating it. An image
   * cannot become fetchable for an opportunity the list will not show.
   *
   * Null covers three cases that must be indistinguishable to a caller:
   * unknown id, not publicly visible, and a snapshot with no usable
   * media (which includes every pre-7A legacy snapshot).
   */
  async findPublicImage(
    id: string
  ): Promise<{ objectKey: string; thumbnailObjectKey: string } | null> {
    const statuses = await this.resolveVisibleStatuses();

    const row = await this.prisma.opportunity.findFirst({
      where: { id, status: { in: statuses } },
      select: { productApprovalSnapshot: { select: { snapshot: true } } },
    });
    if (!row) return null;

    const media = selectMainMedia(row.productApprovalSnapshot?.snapshot);
    if (!media) return null;

    return { objectKey: media.objectKey, thumbnailObjectKey: media.thumbnailObjectKey };
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
    const image = selectMainMedia(row.productApprovalSnapshot?.snapshot);

    return {
      id: row.id,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      // A route, never the storage key. Null when the snapshot carries
      // no usable media — including every pre-7A legacy snapshot.
      imageUrl: image ? `/api/v1/opportunities/${row.id}/image` : null,
      thumbnailUrl: image ? `/api/v1/opportunities/${row.id}/image?variant=thumb` : null,
      // These columns are nullable only while DRAFT. The discovery
      // queries filter to publicly visible statuses, so a null here
      // means the data violates an invariant — surfaced rather than
      // papered over with an empty string, which would render as a
      // blank city and look like a UI bug rather than a data one.
      fulfillmentCityNameAr: assertPresent(row.fulfillmentCityNameAr, row.id, "fulfillmentCityNameAr"),
      fulfillmentCityNameEn: assertPresent(row.fulfillmentCityNameEn, row.id, "fulfillmentCityNameEn"),
      // Genuinely optional even when published, so left nullable.
      salesUnitNameAr: row.salesUnitNameAr,
      salesUnitNameEn: row.salesUnitNameEn,
      endAt: row.endAt,
      status: row.status,
    };
  }

  /**
   * Builds on `toPublicView` rather than restating it, so a field can
   * never be added to the list item and forgotten on the detail — or,
   * far worse, a commercial field slip into the detail alone where the
   * boundary test on the list would not catch it.
   */
  private toPublicDetailView(row: PublicDetailRow): PublicOpportunityDetailView {
    const product = this.parseSnapshot(row.productApprovalSnapshot?.snapshot ?? {});

    return {
      ...this.toPublicView(row),
      productDescriptionAr: product.descriptionAr,
      productDescriptionEn: product.descriptionEn,
      // Genuinely optional even on a published opportunity — unlike the
      // city names, which are asserted.
      fulfillmentRegionNameAr: row.fulfillmentRegionNameAr,
      fulfillmentRegionNameEn: row.fulfillmentRegionNameEn,
      startAt: row.startAt,
    };
  }

  /**
   * The commercial half, shared by the item and the detail.
   *
   * Money is rendered with `Decimal.toFixed(2)`. `toNumber()` is
   * deliberately absent: it would hand the client an IEEE-754 double
   * that cannot hold 125.50 exactly, and the figure would differ from
   * the one checkout freezes and the provider charges.
   */
  private toTerms(row: {
    unitPriceAmount: Prisma.Decimal;
    currency: string;
    targetQuantity: number;
    fundedQuantity: number;
    shareQuantity: number | null;
    shareBasisPoints: number | null;
  }): TraderOpportunityTermsView {
    const { targetQuantity, fundedQuantity } = row;

    return {
      unitPriceInclTaxAmount: row.unitPriceAmount.toFixed(2),
      currency: row.currency,
      targetQuantity,
      fundedQuantity,
      // Clamped: a negative figure would mean the cap was exceeded,
      // which is a data problem to find rather than one to render.
      unsoldQuantity: Math.max(0, targetQuantity - fundedQuantity),
      // Percentage of the supply cap SOLD so far — not "progress toward
      // completion". targetQuantity is a cap, not a collective goal.
      progressPercentage: targetQuantity > 0 ? (fundedQuantity / targetQuantity) * 100 : 0,
      shareQuantity: row.shareQuantity ?? 0,
      // Human percentage derived from basis points (1000 -> 10). The
      // raw basis points and the policy version id stay internal.
      sharePercentage: (row.shareBasisPoints ?? 0) / 100,
    };
  }

  private toTraderView(row: TraderRow): TraderOpportunityItemView {
    return { ...this.toPublicView(row), ...this.toTerms(row) };
  }

  /**
   * Builds on `toPublicDetailView`, so the description, region and
   * window open cannot drift from the anonymous detail — and so a field
   * added there reaches the trader without a second edit.
   */
  private toTraderDetailView(row: TraderDetailRow): TraderOpportunityDetailView {
    return {
      ...this.toPublicDetailView(row),
      ...this.toTerms(row),
      expectedPreparationDays: row.expectedPreparationDays,
    };
  }
}
