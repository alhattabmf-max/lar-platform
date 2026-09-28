import { Injectable } from "@nestjs/common";
import { OpportunityStatus, Prisma } from "@prisma/client";
import {
  DEFAULT_OPPORTUNITY_SORT,
  TAXONOMY_MAX_DEPTH,
  type OpportunitySort,
} from "@platform/types";
import { availableQuantity, type SaleMode } from "@platform/domain";
import { PrismaService } from "../database/prisma.service";
import { OpportunitySettingsService } from "../settings/opportunity-settings.service";
import { parseSnapshotMedia, selectMainMedia } from "./snapshot-media.util";
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
function assertPresent<T>(
  value: T | null,
  opportunityId: string,
  field: string,
): T {
  if (value === null) {
    throw new Error(
      `Opportunity ${opportunityId} is publicly visible but has a null ${field} — this violates the publish-time invariant`,
    );
  }
  return value;
}

interface SnapshotProductData {
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  /**
   * THE PHYSICAL FACTS, read from the same frozen JSON.
   *
   * The builder has written these since it was created — see
   * `product-snapshot.util.ts` — and this parser read four of its
   * fourteen keys. Nothing new is stored; what changed is that the rest
   * is now read.
   *
   * EVERY ONE IS NULLABLE, and not for tidiness: pre-7A snapshots
   * predate these keys entirely, and a legacy row must render as an
   * absence rather than as a zero. A weight of 0 kg is a claim.
   */
  taxonomyNodeId: string | null;
  weightPerUnit: string | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  packageContentQuantity: string | null;
  packageContentUnitNameAr: string | null;
  packageContentUnitNameEn: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * The ANONYMOUS view. Mirrors `PublicOpportunityItem` in
 * @platform/types — see the boundary rationale there.
 *
 * Price, the three quantities and progress are public BY DECISION, so a
 * visitor can judge an offer before creating an account. What stays
 * behind the trader guard is what describes the platform rather than
 * the offer: `fundedQuantity`, `sharePercentage`,
 * `expectedPreparationDays`, and anything identifying the supplier.
 *
 * Money is a decimal STRING here for the same reason it is everywhere
 * else — a JSON number cannot hold 287.50 exactly.
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
  /** Genuinely optional even when published, unlike the city. */
  fulfillmentRegionNameAr: string | null;
  fulfillmentRegionNameEn: string | null;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  unitPriceInclTaxAmount: string;
  currency: string;
  targetQuantity: number;
  /** targetQuantity − fundedQuantity. Never a promise of availability. */
  unsoldQuantity: number;
  /** Share of the supply cap SOLD so far. */
  progressPercentage: number;
  /** Minimum purchase AND the increment step. NULL for a direct sale. */
  shareQuantity: number | null;
  /** NULL for a direct sale, which has no window. */
  endAt: Date | null;
  status: OpportunityStatus;
  /** Which of the two sales paths this listing is. */
  saleMode: SaleMode;
}

/**
 * The anonymous DETAIL view: the list item plus descriptive context.
 *
 * Adds only the description and the window open. Region and terms live
 * on the item now, so the detail cannot hold a second, divergent copy.
 * Still no `expectedPreparationDays` — a supply commitment belongs with
 * the trader terms.
 */
export interface PublicOpportunityDetailView extends PublicOpportunityView {
  productDescriptionAr: string | null;
  productDescriptionEn: string | null;
  startAt: Date;
  /**
   * THE PRODUCT'S OWN FACTS, read from the same frozen snapshot the
   * name and the description come from. Nothing new is stored: the
   * builder has written all of these since it existed, and the parser
   * read four of its fourteen keys.
   *
   * NULLABLE THROUGHOUT, because a pre-7A snapshot predates the keys —
   * an absence must render as one, never as a zero.
   */
  taxonomyNodeId: string | null;
  weightPerUnit: string | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  packageContentQuantity: string | null;
  packageContentUnitNameAr: string | null;
  packageContentUnitNameEn: string | null;
  /** Every photograph, main first — the same route with an index. */
  imageUrls: string[];
  thumbnailUrls: string[];
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
  /**
   * `targetQuantity − fundedQuantity − every live lock` — the ceiling a
   * quantity picker may offer, counting what other buyers are holding
   * in open baskets and unfinished payments.
   *
   * Zero on a direct listing is «نفد المخزون».
   */
  availableQuantity: number;
  /** Minimum purchase AND the increment step. NULL for a direct sale. */
  shareQuantity: number | null;
  /** Human percentage (e.g. 10, 2.5) — never raw basis points. NULL for a direct sale. */
  sharePercentage: number | null;
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
  extends PublicOpportunityView, TraderOpportunityTermsView {}

/**
 * The trader DETAIL view: the public detail plus the same terms.
 *
 * `expectedPreparationDays` is added HERE and nowhere public: it is how
 * long the supplier has to prepare after payment — a supply commitment
 * a trader needs before buying, and not a property of the product.
 */
export interface TraderOpportunityDetailView
  extends PublicOpportunityDetailView, TraderOpportunityTermsView {
  expectedPreparationDays: number;
}

/**
 * The columns the PUBLIC terms are built from.
 *
 * `fundedQuantity` is selected because `unsoldQuantity` and
 * `progressPercentage` are derived from it — it is read, never
 * returned. `shareBasisPoints` is NOT here: `sharePercentage` stays
 * trader-only.
 */
const PUBLIC_TERMS_SELECT = {
  unitPriceAmount: true,
  currency: true,
  targetQuantity: true,
  fundedQuantity: true,
  shareQuantity: true,
} satisfies Prisma.OpportunitySelect;

const PUBLIC_SELECT = {
  id: true,
  saleMode: true,
  fulfillmentCityNameAr: true,
  fulfillmentCityNameEn: true,
  fulfillmentRegionNameAr: true,
  fulfillmentRegionNameEn: true,
  salesUnitNameAr: true,
  salesUnitNameEn: true,
  endAt: true,
  status: true,
  ...PUBLIC_TERMS_SELECT,
  productApprovalSnapshot: { select: { snapshot: true } },
} satisfies Prisma.OpportunitySelect;

const PUBLIC_DETAIL_SELECT = {
  ...PUBLIC_SELECT,
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
const ORDER_BY: Record<
  OpportunitySort,
  Prisma.OpportunityOrderByWithRelationInput[]
> = {
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
  ...PUBLIC_TERMS_SELECT,
  // The only column a trader sees that the public select does not:
  // sharePercentage is derived from it and stays behind the guard.
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
type PublicDetailRow = Prisma.OpportunityGetPayload<{
  select: typeof PUBLIC_DETAIL_SELECT;
}>;
type TraderRow = Prisma.OpportunityGetPayload<{ select: typeof TRADER_SELECT }>;
type TraderDetailRow = Prisma.OpportunityGetPayload<{
  select: typeof TRADER_DETAIL_SELECT;
}>;

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
    private readonly opportunitySettings: OpportunitySettingsService,
  ) {}

  async listPublic(
    query: ListOpportunitiesQueryDto,
  ): Promise<PaginatedResult<PublicOpportunityView>> {
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

    return {
      items: rows.map((r) => this.toPublicView(r)),
      page,
      pageSize,
      total,
    };
  }

  async getPublicDetail(
    id: string,
  ): Promise<PublicOpportunityDetailView | null> {
    const statuses = await this.resolveVisibleStatuses();
    const row = await this.prisma.opportunity.findFirst({
      where: { id, status: { in: statuses } },
      select: PUBLIC_DETAIL_SELECT,
    });
    return row ? this.toPublicDetailView(row) : null;
  }

  async listForTrader(
    query: ListOpportunitiesQueryDto,
  ): Promise<PaginatedResult<TraderOpportunityItemView>> {
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

    const locked = await this.activeLockedByOpportunity(rows.map((r) => r.id));

    return {
      items: rows.map((r) => this.toTraderView(r, locked.get(r.id) ?? 0)),
      page,
      pageSize,
      total,
    };
  }

  async getTraderDetail(
    id: string,
  ): Promise<TraderOpportunityDetailView | null> {
    const statuses = await this.resolveVisibleStatuses();
    const row = await this.prisma.opportunity.findFirst({
      where: { id, status: { in: statuses } },
      select: TRADER_DETAIL_SELECT,
    });
    if (!row) return null;
    const locked = await this.activeLockedByOpportunity([row.id]);
    return this.toTraderDetailView(row, locked.get(row.id) ?? 0);
  }

  private async resolveVisibleStatuses(): Promise<OpportunityStatus[]> {
    const settings = await this.opportunitySettings.getConfig();
    const statuses: OpportunityStatus[] = [OpportunityStatus.ACTIVE];
    if (settings.showScheduledPubliclyEnabled) {
      statuses.push(OpportunityStatus.SCHEDULED);
    }
    return statuses;
  }

  /**
   * A node and everything under it, as a flat id list.
   *
   * BOUNDED BY THE TREE, not by recursion: `TAXONOMY_MAX_DEPTH` is 3,
   * so two widening steps reach every descendant there can be. Written
   * as a loop over that constant rather than a recursive CTE so the
   * bound is visible and a deeper tree fails loudly at the depth guard
   * instead of quietly walking further here.
   *
   * The selected node is always included: a leaf is its own subtree,
   * and a parent whose children were deactivated must still find what
   * was filed on it while it was a leaf.
   *
   * Inactive descendants are kept too. Deactivating a category is a
   * decision about what may be filed NEXT — it must not hide listings
   * that were legitimately published under it and are still live.
   */
  private async resolveSubtree(rootId: string): Promise<string[]> {
    const collected = [rootId];
    let frontier = [rootId];

    for (let step = 1; step < TAXONOMY_MAX_DEPTH; step += 1) {
      if (frontier.length === 0) break;
      const children = await this.prisma.taxonomyNode.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((child) => child.id);
      collected.push(...frontier);
    }

    return collected;
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

    // FREE TEXT, RESOLVED TO A SET OF IDS FIRST — «الاسم والوصف معًا».
    //
    // WHY NOT IN THE PRISMA `where`. The product's name lives inside
    // the approval snapshot's JSON, and Prisma's JSON `string_contains`
    // is CASE-SENSITIVE — `mode: "insensitive"` is rejected outright on
    // a JSON path in 5.22, which I confirmed against this database
    // rather than assumed. A search for "cement" that misses "Cement"
    // is not a search.
    //
    // SO POSTGRES DOES THE MATCHING, with ILIKE, and Prisma does
    // everything else. The prefilter carries the STATUS FILTER too, so
    // what comes back is bounded by the offers a reader could see
    // anyway — never the whole table — and region, category, sort and
    // paging all still happen in the one query below, unchanged.
    //
    // AN EMPTY RESULT IS A RESULT. `in: []` matches nothing, which is
    // the honest answer to a term nothing carries — not a silent
    // fallback to the unfiltered list.
    if (query.q) {
      where.id = { in: await this.idsMatching(query.q, statuses) };
    }
    // THE REGION NARROWS; THE CITY NARROWS FURTHER. Both may be sent,
    // and sending a city outside the chosen region simply matches
    // nothing — which is the honest answer to a contradictory filter,
    // not something to silently resolve one way or the other.
    if (query.regionId) where.fulfillmentRegionId = query.regionId;
    if (query.cityId) where.fulfillmentCityId = query.cityId;
    if (query.productId) where.productId = query.productId;
    if (query.taxonomyNodeId) {
      // THE SUBTREE, not the node.
      //
      // Products may no longer be filed on a node that has children
      // (`TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS`), so equality here would
      // make every parent in the category bar return an empty page —
      // «مواد البناء» has no listings of its own and never will.
      // Matching the subtree is what makes that rule survivable, and
      // the two constants say so to each other.
      //
      // Still against the FROZEN snapshot's own taxonomyNodeId (captured
      // at product-approval time — see admin-products.service.ts), never
      // against the live Product row. A category change on the live
      // product after a listing was published must never affect
      // that listing's filterability, exactly as it must never
      // affect what is displayed for it.
      const subtree = await this.resolveSubtree(query.taxonomyNodeId);

      where.productApprovalSnapshot = {
        is: {
          OR: subtree.map((id) => ({
            snapshot: { path: ["taxonomyNodeId"], equals: id },
          })),
        },
      };
    }

    return { where, orderBy, page, pageSize };
  }

  /**
   * The visible offers whose frozen text carries `term`.
   *
   * FOUR FIELDS FROM THE SNAPSHOT AND TWO FROM THE OFFER: the product's
   * name and description as they were frozen at approval, and the
   * offer's own note. That is exactly the text a reader sees on the
   * card and on the page, which is the only text it is honest to
   * search.
   *
   * THE TERM IS A VALUE, NEVER SQL. It is bound as a parameter, and its
   * LIKE metacharacters are escaped first — otherwise a reader typing
   * `%` matches everything and a reader typing `_` matches one of
   * anything, which is a wrong answer rather than an injection, but
   * still a wrong answer. The backslash is escaped before the other
   * two, or it would double the escapes it just introduced.
   */
  private async idsMatching(term: string, statuses: OpportunityStatus[]): Promise<string[]> {
    const pattern =
      "%" +
      term
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_") +
      "%";

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT o.id
      FROM opportunities o
      LEFT JOIN product_approval_snapshots s ON s.id = o.product_approval_snapshot_id
      WHERE o.status = ANY(${statuses}::"OpportunityStatus"[])
        AND (
          s.snapshot->>'nameAr' ILIKE ${pattern}
          OR s.snapshot->>'nameEn' ILIKE ${pattern}
          OR s.snapshot->>'descriptionAr' ILIKE ${pattern}
          OR s.snapshot->>'descriptionEn' ILIKE ${pattern}
          OR o.description_ar ILIKE ${pattern}
          OR o.description_en ILIKE ${pattern}
        )
    `;

    return rows.map((row) => row.id);
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
    id: string,
  ): Promise<{ objectKey: string; thumbnailObjectKey: string } | null> {
    const statuses = await this.resolveVisibleStatuses();

    const row = await this.prisma.opportunity.findFirst({
      where: { id, status: { in: statuses } },
      select: { productApprovalSnapshot: { select: { snapshot: true } } },
    });
    if (!row) return null;

    const media = selectMainMedia(row.productApprovalSnapshot?.snapshot);
    if (!media) return null;

    return {
      objectKey: media.objectKey,
      thumbnailObjectKey: media.thumbnailObjectKey,
    };
  }

  private parseSnapshot(raw: Prisma.JsonValue): SnapshotProductData {
    const v = raw as Record<string, unknown>;
    // A STRING OR NOTHING. The snapshot is JSON with no schema at read
    // time, and a legacy row simply lacks these keys — so anything that
    // is not a string reads as absent rather than as an empty value a
    // page would print.
    const text = (key: string): string | null =>
      typeof v[key] === "string" && v[key] !== "" ? (v[key] as string) : null;

    return {
      nameAr: typeof v.nameAr === "string" ? v.nameAr : "",
      nameEn: typeof v.nameEn === "string" ? v.nameEn : "",
      descriptionAr:
        typeof v.descriptionAr === "string" ? v.descriptionAr : null,
      descriptionEn:
        typeof v.descriptionEn === "string" ? v.descriptionEn : null,
      taxonomyNodeId: text("taxonomyNodeId"),
      weightPerUnit: text("weightPerUnit"),
      lengthCm: text("lengthCm"),
      widthCm: text("widthCm"),
      heightCm: text("heightCm"),
      packageContentQuantity: text("packageContentQuantity"),
      packageContentUnitNameAr: text("packageContentUnitNameAr"),
      packageContentUnitNameEn: text("packageContentUnitNameEn"),
    };
  }

  private toPublicView(row: PublicRow): PublicOpportunityView {
    const product = this.parseSnapshot(
      row.productApprovalSnapshot?.snapshot ?? {},
    );
    const image = selectMainMedia(row.productApprovalSnapshot?.snapshot);

    return {
      id: row.id,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      // A route, never the storage key. Null when the snapshot carries
      // no usable media — including every pre-7A legacy snapshot.
      imageUrl: image ? `/api/v1/opportunities/${row.id}/image` : null,
      thumbnailUrl: image
        ? `/api/v1/opportunities/${row.id}/image?variant=thumb`
        : null,
      // These columns are nullable only while DRAFT. The discovery
      // queries filter to publicly visible statuses, so a null here
      // means the data violates an invariant — surfaced rather than
      // papered over with an empty string, which would render as a
      // blank city and look like a UI bug rather than a data one.
      fulfillmentCityNameAr: assertPresent(
        row.fulfillmentCityNameAr,
        row.id,
        "fulfillmentCityNameAr",
      ),
      fulfillmentCityNameEn: assertPresent(
        row.fulfillmentCityNameEn,
        row.id,
        "fulfillmentCityNameEn",
      ),
      // Genuinely optional even when published, so left nullable —
      // unlike the city names, which are asserted above.
      fulfillmentRegionNameAr: row.fulfillmentRegionNameAr,
      fulfillmentRegionNameEn: row.fulfillmentRegionNameEn,
      salesUnitNameAr: row.salesUnitNameAr,
      salesUnitNameEn: row.salesUnitNameEn,
      ...this.toPublicTerms(row),
      endAt: row.endAt,
      status: row.status,
      saleMode: row.saleMode as SaleMode,
    };
  }

  /**
   * The commercial fields a VISITOR may see.
   *
   * `fundedQuantity` is read here and deliberately not returned: the
   * two figures derived from it are what a visitor needs, and how much
   * has been sold in absolute terms is not.
   *
   * Money uses `Decimal.toFixed(2)`. `toNumber()` is absent on purpose —
   * it would hand the client an IEEE-754 double for a figure that gets
   * reconciled against a bank statement.
   */
  private toPublicTerms(row: {
    unitPriceAmount: Prisma.Decimal;
    currency: string;
    targetQuantity: number;
    fundedQuantity: number;
    shareQuantity: number | null;
  }) {
    const { targetQuantity, fundedQuantity } = row;

    return {
      unitPriceInclTaxAmount: row.unitPriceAmount.toFixed(2),
      currency: row.currency,
      targetQuantity,
      // Clamped: a negative figure would mean the cap was exceeded,
      // which is a data problem to find rather than one to render.
      unsoldQuantity: Math.max(0, targetQuantity - fundedQuantity),
      // Percentage of the supply cap SOLD so far — not "progress toward
      // completion". targetQuantity is a cap, not a collective goal.
      progressPercentage:
        targetQuantity > 0 ? (fundedQuantity / targetQuantity) * 100 : 0,
      // NULL FOR A DIRECT LISTING — it has no share and no step. A zero
      // would be read by a picker as «buy in steps of zero».
      shareQuantity: row.shareQuantity,
    };
  }

  /**
   * Builds on `toPublicView` rather than restating it, so a field can
   * never be added to the list item and forgotten on the detail — or,
   * far worse, a commercial field slip into the detail alone where the
   * boundary test on the list would not catch it.
   */
  private toPublicDetailView(
    row: PublicDetailRow,
  ): PublicOpportunityDetailView {
    const product = this.parseSnapshot(
      row.productApprovalSnapshot?.snapshot ?? {},
    );

    // EVERY PHOTOGRAPH, in the snapshot's own order. The same route the
    // card uses, with an index — not a second endpoint.
    const media = parseSnapshotMedia(row.productApprovalSnapshot?.snapshot);

    return {
      ...this.toPublicView(row),
      productDescriptionAr: product.descriptionAr,
      productDescriptionEn: product.descriptionEn,
      startAt: row.startAt,
      taxonomyNodeId: product.taxonomyNodeId,
      weightPerUnit: product.weightPerUnit,
      lengthCm: product.lengthCm,
      widthCm: product.widthCm,
      heightCm: product.heightCm,
      packageContentQuantity: product.packageContentQuantity,
      packageContentUnitNameAr: product.packageContentUnitNameAr,
      packageContentUnitNameEn: product.packageContentUnitNameEn,
      imageUrls: media.map(
        (_, i) => `/api/v1/opportunities/${row.id}/image?index=${i}`,
      ),
      thumbnailUrls: media.map(
        (_, i) =>
          `/api/v1/opportunities/${row.id}/image?index=${i}&variant=thumb`,
      ),
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
  private toTerms(
    row: {
      id: string;
      unitPriceAmount: Prisma.Decimal;
      currency: string;
      targetQuantity: number;
      fundedQuantity: number;
      shareQuantity: number | null;
      shareBasisPoints: number | null;
    },
    activeLockedQuantity: number,
  ): TraderOpportunityTermsView {
    return {
      // Composed from the public half rather than restated, so a
      // visitor and a trader can never be shown different arithmetic
      // for the same opportunity.
      ...this.toPublicTerms(row),
      fundedQuantity: row.fundedQuantity,
      // THE CEILING A QUANTITY PICKER MAY OFFER — the same arithmetic
      // the checkout performs under the offer row lock, computed here
      // without one. It can only be stale in the safe direction often
      // enough to matter: a lock taken after this read makes the real
      // ceiling lower, and the checkout refuses; a lock released makes
      // it higher, and the buyer is merely offered less than they could
      // have had.
      availableQuantity: availableQuantity({
        targetQuantity: row.targetQuantity,
        fundedQuantity: row.fundedQuantity,
        activeLockedQuantity,
      }),
      // Human percentage derived from basis points (1000 -> 10). The
      // raw basis points and the policy version id stay internal. NULL
      // for a direct sale, which has no share at all — a zero here
      // would read as «zero per cent», which is a different claim.
      sharePercentage: row.shareBasisPoints === null ? null : row.shareBasisPoints / 100,
    };
  }

  /**
   * How much of each listing is held in live baskets and unfinished
   * payments right now.
   *
   * ONE QUERY FOR THE WHOLE PAGE, not one per row: a listing page of
   * twenty would otherwise cost twenty round trips for a number that is
   * advisory. The filter is character-for-character the one the checkout
   * uses under its row lock — LOCKED not expired, or PAYMENT_PENDING not
   * past its deadline — so the ceiling a buyer is shown and the ceiling
   * they are held to are the same rule.
   */
  private async activeLockedByOpportunity(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ opportunity_id: string; sum: number }[]>`
      SELECT opportunity_id, COALESCE(SUM(locked_quantity), 0)::int AS sum
      FROM checkout_sessions
      WHERE opportunity_id = ANY(${ids}::uuid[]) AND lock_released_at IS NULL
        AND (
          (status = 'LOCKED' AND lock_expires_at > now())
          OR (status = 'PAYMENT_PENDING' AND payment_deadline_at > now())
        )
      GROUP BY opportunity_id
    `;
    return new Map(rows.map((r) => [r.opportunity_id, r.sum]));
  }

  private toTraderView(row: TraderRow, activeLockedQuantity: number): TraderOpportunityItemView {
    return { ...this.toPublicView(row), ...this.toTerms(row, activeLockedQuantity) };
  }

  /**
   * Builds on `toPublicDetailView`, so the description, region and
   * window open cannot drift from the anonymous detail — and so a field
   * added there reaches the trader without a second edit.
   */
  private toTraderDetailView(
    row: TraderDetailRow,
    activeLockedQuantity: number,
  ): TraderOpportunityDetailView {
    return {
      ...this.toPublicDetailView(row),
      ...this.toTerms(row, activeLockedQuantity),
      expectedPreparationDays: row.expectedPreparationDays,
    };
  }
}
