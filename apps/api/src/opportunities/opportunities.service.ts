import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AccountType,
  AuditActorType,
  OpportunityStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  computeTaxSnapshot,
  selectTier,
  computeShareQuantity,
  suggestCompatibleQuantities,
  availableQuantity,
  minimumDirectStock,
  type SaleMode,
  type ShareTier,
} from "@platform/domain";
import { evaluateLiveEligibility, type Blocker } from "@platform/opportunity-lifecycle";
import {
  SUPPLIER_OPPORTUNITY_LIVE_STATUSES,
  type SupplierOpportunityDetail,
  type SupplierOpportunitySummary,
} from "@platform/types";
import {
  SUPPLIER_OPPORTUNITY_DETAIL_SELECT,
  SUPPLIER_OPPORTUNITY_SUMMARY_SELECT,
  ownedOpportunityWhere,
  toSupplierOpportunityDetail,
  toSupplierOpportunitySummary,
} from "./supplier-opportunity.view";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OpportunitySettingsService } from "../settings/opportunity-settings.service";
import { ShareTierSettingsService } from "../settings/share-tier-settings.service";
import { CommissionPolicyService } from "../settings/commission-policy.service";
import { isLegacySnapshotShape } from "../products/product-snapshot.util";
import { TAX_RATE_PROVIDER, type TaxRateProvider } from "../tax/tax-rate-provider.interface";
import { BusinessException } from "../common/errors/business-exception";
import { assertNoBuyerCommitted } from "../common/removal";
import { releaseActiveLocksForOpportunityTx } from "../checkout/checkout-lock-release.util";
import { ERROR_CODES } from "@platform/types";
import type { CreateOpportunityDto } from "./dto/create-opportunity.dto";
import type { SetDirectStockDto } from "./dto/set-direct-stock.dto";
import { releaseFundedAllocationsTx } from "./release-funded-allocations.util";
import type { UpdateOpportunityDto } from "./dto/update-opportunity.dto";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * The statuses that make an offer stand between its product and a
 * second publication.
 *
 * READ FROM THE SHARED CONTRACT, never listed again here. The portal
 * hides its «إنشاء عرض» button on this same list; a second copy would
 * eventually disagree with this one, and the disagreement would surface
 * as a button leading straight to a refusal.
 */
const LIVE_STATUSES = SUPPLIER_OPPORTUNITY_LIVE_STATUSES.map(
  (status) => OpportunityStatus[status]
);

/** A day, in milliseconds. Named, because the literal in an expression is a riddle. */
const DAY_MS = 86_400_000;

/** A window of `days`, opening now. */
function windowFromNow(days: number): { startAt: Date; endAt: Date } {
  const startAt = new Date();
  return { startAt, endAt: new Date(startAt.getTime() + days * DAY_MS) };
}

/**
 * The duration a stored window represents, recovered from its ends.
 *
 * Rounded, because the pair the portal writes is exact to the
 * millisecond — but a row created through the older route may carry any
 * two instants, and a supplier who set "seven days and four minutes"
 * meant seven. Never less than a day: a window that rounded to zero
 * would open and close in the same instant.
 */
function daysBetween(startAt: Date, endAt: Date): number {
  return Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / DAY_MS));
}

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface SnapshotFields {
  /** Null when the branch names no city. */
  fulfillmentCityId: string | null;
  fulfillmentCityNameAr: string | null;
  fulfillmentCityNameEn: string | null;
  fulfillmentRegionId: string;
  fulfillmentRegionNameAr: string;
  fulfillmentRegionNameEn: string;
  productApprovalSnapshotId: string;
  /**
   * Decimal STRINGS, not numbers.
   *
   * Every one of these is written to a `Decimal` column. Prisma accepts a
   * string for such a column and stores the digits verbatim, so carrying
   * them as strings from the computation to the write means no binary
   * double ever holds a value on its way into the database.
   */
  taxRatePercent: string;
  unitPriceExclTaxAmount: string;
  unitTaxAmount: string;
  taxCalculationRuleCode: string;
  taxCalculationRuleVersion: string;
  /**
   * THE FIVE SHARE FIELDS ARE NULL FOR A DIRECT LISTING.
   *
   * They are the collective offer's own arithmetic: the total value a
   * tier was chosen by, the pinned policy version, the tier, its basis
   * points and the quantity one buyer takes. A fixed-price sale from
   * stock has no tier and no share — the buyer names their own quantity
   * — so these are absent rather than zero, and
   * `opportunities_share_snapshot_consistency` refuses a DIRECT row that
   * carries any of them.
   */
  totalValueInclTaxAmount: string | null;
  shareTierPolicyVersionId: string | null;
  shareTierIndex: number | null;
  shareBasisPoints: number | null;
  shareQuantity: number | null;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  packageContentQuantity: number | null;
  packageContentUnitNameAr: string | null;
  packageContentUnitNameEn: string | null;
  commissionPolicyVersionId: string;
  commissionRateBasisPoints: number;
}

/**
 * THE STATES AN OFFER CAN STILL BE EDITED IN — «احذف العرض أو
 * عدّله دام ما عليه أي عملية».
 *
 * ACTIVE AND PAUSED ARE NEW HERE, and they are the owner's ruling:
 * an offer that is on the market but that nobody has bought from is
 * still the supplier's to correct. What used to stop it was the date
 * of its first activation, in the service and in a database trigger
 * both — a proxy for «somebody may be relying on this» that was
 * wrong in the common case, because most live offers have no buyer
 * at all.
 *
 * THE REAL STOP IS THE BUYER, and it is asked separately, right
 * before the write: `assertNoBuyerCommitted`.
 *
 * FUNDED, EXPIRED AND CANCELLED ARE NOT HERE and never will be.
 * They are not refusals about money — they are finished states, and
 * editing one would be editing the past.
 */
const EDITABLE_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.DRAFT,
  OpportunityStatus.SCHEDULED,
  OpportunityStatus.ACTION_REQUIRED,
  OpportunityStatus.ACTIVE,
  OpportunityStatus.PAUSED,
];

/**
 * WHO IS EDITING — the supplier, or an administrator on his behalf.
 *
 * ONE METHOD, TWO CALLERS. «حذف وتعديل العرض من صفحة المورّد ومن
 * صفحة الإدارة» is one act asked from two desks, and a second copy
 * of it for the console would be a second set of rules to keep in
 * step. What differs between the two is not what may be changed —
 * that is identical — it is WHO the audit log names and how the row
 * was reached: the supplier's route reads it through his own
 * company, the console's reads it directly.
 *
 * AND THE LOG SAYS WHICH. An operator's edit to a supplier's offer
 * is a different event from the supplier's own, and somebody
 * reading the history months later must be able to tell them
 * apart without inferring it from an id.
 */
interface EditingActor {
  actorType: AuditActorType;
  action: string;
}

const SUPPLIER_EDIT: EditingActor = {
  actorType: AuditActorType.USER,
  action: "OPPORTUNITY_UPDATED",
};

const ADMIN_EDIT: EditingActor = {
  actorType: AuditActorType.ADMIN,
  action: "OPPORTUNITY_UPDATED_BY_ADMIN",
};

class TaxRateUnavailableError extends Error {}

/**
 * A validated number, as a canonical decimal string at scale 2.
 *
 * `String(value)` is JavaScript's shortest round-tripping representation,
 * so for a value the DTO has already constrained to at most two decimal
 * places it is the exact digits the supplier typed. `Prisma.Decimal` then
 * re-reads those digits rather than a binary double.
 *
 * Guarded rather than trusted: a non-finite value reaching a money column
 * would be a defect the DTO should have caught, and it must not be turned
 * into "NaN" and handed to Prisma.
 */
function toCanonicalMoney(value: number, field: string): string {
  if (!Number.isFinite(value)) {
    throw new BusinessException(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must be a finite amount`
    );
  }
  return new Prisma.Decimal(String(value)).toFixed(2);
}

class PurchaseQuantityIncompatibleError extends Error {
  constructor(public readonly suggestions: { below: number | null; above: number | null }) {
    super("Purchase quantity is not compatible with the current share-tier policy");
  }
}

// The supplier-facing projection moved to supplier-opportunity.view.ts in
// 8E.4. Deleted rather than left in place: it mapped a RAW row — so it was
// the only thing standing between the supplier and shareTierPolicyVersionId,
// commissionRateBasisPoints and the admin's free-text pauseReason — and it
// sent every money field through Decimal.toNumber(), which is the exact
// defect contracts/money.ts exists to prevent.

/**
 * THE MOST RECENT FIVE HUNDRED LISTINGS, AND NO MORE.
 *
 * A DELIBERATE CEILING, NOT A PAGE, for the same reason as the product
 * catalogue: this list grows with ONE supplier and the screen draws it
 * whole. Offers ACCUMULATE — a closed listing stays on the record —
 * so this is the list most likely to reach its ceiling one day.
 *
 * THE ORDER DECIDES WHICH END IS CUT, and it is `createdAt desc`: the
 * ceiling drops the OLDEST listings, so a supplier always sees their
 * live and recent work. Reaching it is the signal to build a pager,
 * not to raise the number.
 */
const MAX_OWN_LISTINGS = 500;

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly opportunitySettings: OpportunitySettingsService,
    private readonly shareTierSettings: ShareTierSettingsService,
    private readonly commissionPolicy: CommissionPolicyService,
    @Inject(TAX_RATE_PROVIDER) private readonly taxRateProvider: TaxRateProvider
  ) {}

  /**
   * The supplier's own listings, as the closed `SupplierOpportunitySummary`.
   *
   * Ownership is IN THE QUERY. Ordering terminates in the primary key: two
   * listings created in the same millisecond must not swap places between
   * requests.
   */
  async listMineProjected(companyId: string): Promise<SupplierOpportunitySummary[]> {
    const rows = await this.prisma.opportunity.findMany({
      where: ownedOpportunityWhere(companyId),
      select: SUPPLIER_OPPORTUNITY_SUMMARY_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: MAX_OWN_LISTINGS,
    });

    return rows.map(toSupplierOpportunitySummary);
  }

  /** One listing, as the closed `SupplierOpportunityDetail`. */
  async getOwnedProjected(id: string, companyId: string): Promise<SupplierOpportunityDetail> {
    const row = await this.prisma.opportunity.findFirst({
      where: { id, ...ownedOpportunityWhere(companyId) },
      select: SUPPLIER_OPPORTUNITY_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException("Opportunity not found");

    return toSupplierOpportunityDetail(row);
  }

  /**
   * The FULL row, for this service's own writes.
   *
   * Deliberately not a projection: `update`, `publish`, `extend` and
   * `deleteDraft` need the pinned policy version ids and the snapshot fields
   * to do their work. It must never be returned from a controller — the
   * projected reads above are what leave the server.
   */
  async getOwned(id: string, companyId: string) {
    const opp = await this.prisma.opportunity.findFirst({ where: { id, companyId } });
    if (!opp) throw new NotFoundException("Opportunity not found");
    return opp;
  }

  async create(dto: CreateOpportunityDto, ctx: ActorContext) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    if (company.accountType !== AccountType.SUPPLIER) {
      throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "Only supplier accounts can create opportunities");
    }

    await this.requireOwnedProduct(dto.productId, ctx.companyId);
    await this.requireOwnedLocation(dto.fulfillmentLocationId, ctx.companyId);

    const saleMode: SaleMode = dto.saleMode ?? "GROUP";

    /**
     * A DIRECT LISTING HAS NO WINDOW, and one sent anyway is refused
     * rather than ignored.
     *
     * Dropping it silently would leave the supplier believing they had
     * set a closing date that nothing would ever honour. `start_at` is
     * still written — it is when the shelf opened, and the column is
     * NOT NULL — but it is stamped by the platform at publish, not
     * chosen: a DIRECT listing goes on the market when it is published
     * and not at some later hour.
     */
    if (saleMode === "DIRECT" && (dto.startAt !== undefined || dto.endAt !== undefined)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "A direct sale has no sales window — startAt and endAt do not apply to it"
      );
    }
    if (saleMode === "GROUP" && (dto.startAt === undefined || dto.endAt === undefined)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "A group offer needs startAt and endAt"
      );
    }

    const startAt = saleMode === "DIRECT" ? new Date() : new Date(dto.startAt!);
    const endAt = saleMode === "DIRECT" ? null : new Date(dto.endAt!);
    await this.validateOperationalBounds({ targetQuantity: dto.targetQuantity, startAt, endAt });

    const opp = await this.prisma.opportunity.create({
      data: {
        companyId: ctx.companyId,
        productId: dto.productId,
        saleMode,
        fulfillmentLocationId: dto.fulfillmentLocationId,
        targetQuantity: dto.targetQuantity,
        unitPriceAmount: dto.unitPriceAmount,
        startAt,
        endAt,
        expectedPreparationDays: dto.expectedPreparationDays,
        descriptionAr: dto.descriptionAr,
        descriptionEn: dto.descriptionEn,
      },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "OPPORTUNITY_CREATED",
      entityType: "opportunity",
      entityId: opp.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return opp;
  }

  /**
   * DRAFT: plain field update, no snapshot involved (none exists yet).
   * ACTION_REQUIRED: ALSO a plain field update — its existing snapshot,
   * status, and reason fields are deliberately left untouched; the
   * supplier can correct the underlying data, but re-validation and
   * snapshot rebuild only happen explicitly via publish() (republish).
   * SCHEDULED: snapshots (location/region/product/tax) ARE atomically
   * regenerated in the SAME transaction as the field update, so a
   * stale snapshot can never sit alongside new data. A SCHEDULED row
   * whose start_at has already passed (even if the worker hasn't
   * caught up yet) is rejected — checked again INSIDE the transaction
   * against a freshly-read row for true atomicity.
   * ACTIVE and PAUSED: the same atomic snapshot regeneration as
   * SCHEDULED, minus the start-time check — an offer that is on the
   * market has a start time in the past by definition, and its start
   * is therefore held where it is rather than moved.
   *
   * AND IN EVERY STATE, THE BUYER DECIDES. `assertNoBuyerCommitted`
   * runs first: a live basket refuses temporarily, a payment refuses
   * for good.
   */
  async update(
    id: string,
    dto: UpdateOpportunityDto,
    ctx: ActorContext,
    who: EditingActor = SUPPLIER_EDIT
  ) {
    const existing = await this.getOwned(id, ctx.companyId);

    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Cannot edit an opportunity with status ${existing.status}`
      );
    }

    await assertNoBuyerCommitted(this.prisma, [id]);

    const productId = dto.productId ?? existing.productId;
    const fulfillmentLocationId = dto.fulfillmentLocationId ?? existing.fulfillmentLocationId;
    // A decimal STRING throughout. The stored value is re-read with
    // `toFixed(2)` rather than `toNumber()`, and a submitted one goes
    // through its own canonical form — neither becomes a binary double on
    // the way to the tax computation or the column.
    const unitPriceAmount =
      dto.unitPriceAmount !== undefined
        ? toCanonicalMoney(dto.unitPriceAmount, "unitPriceAmount")
        : existing.unitPriceAmount.toFixed(2);
    const targetQuantity = dto.targetQuantity ?? existing.targetQuantity;
    // AN OFFER ON THE MARKET KEEPS ITS START. Everything else about
    // it may be corrected, but the moment it opened is a fact that
    // already happened — and `first_activated_at` records it either
    // way, so moving `start_at` would only make the two disagree.
    const onTheMarket =
      existing.status === OpportunityStatus.ACTIVE ||
      existing.status === OpportunityStatus.PAUSED;
    const startAt = onTheMarket
      ? existing.startAt
      : dto.startAt
        ? new Date(dto.startAt)
        : existing.startAt;
    // A DIRECT LISTING KEEPS ITS EMPTY WINDOW. `end_at` is NULL for it
    // by constraint, and an edit that set one would be refused by the
    // database — better to refuse it here, where the reason can be said
    // in words.
    if (existing.saleMode === "DIRECT" && (dto.startAt !== undefined || dto.endAt !== undefined)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "A direct sale has no sales window — startAt and endAt do not apply to it"
      );
    }
    const endAt =
      existing.saleMode === "DIRECT" ? null : dto.endAt ? new Date(dto.endAt) : existing.endAt;

    if (dto.productId) await this.requireOwnedProduct(dto.productId, ctx.companyId);
    if (dto.fulfillmentLocationId) await this.requireOwnedLocation(dto.fulfillmentLocationId, ctx.companyId);
    await this.validateOperationalBounds({ targetQuantity, startAt, endAt });

    const baseData = {
      productId,
      fulfillmentLocationId,
      unitPriceAmount,
      targetQuantity,
      startAt,
      endAt,
      expectedPreparationDays: dto.expectedPreparationDays ?? existing.expectedPreparationDays,
      descriptionAr: dto.descriptionAr !== undefined ? dto.descriptionAr : existing.descriptionAr ?? undefined,
      descriptionEn: dto.descriptionEn !== undefined ? dto.descriptionEn : existing.descriptionEn ?? undefined,
    };

    if (existing.status === OpportunityStatus.DRAFT || existing.status === OpportunityStatus.ACTION_REQUIRED) {
      // DRAFT: no snapshot exists yet. ACTION_REQUIRED: its existing
      // (possibly stale) snapshot, status, and reason fields are
      // deliberately left untouched here — the supplier is free to
      // correct the underlying data, but re-validation and snapshot
      // rebuild only happen explicitly via publish() (republish).
      // This also keeps the DB CHECK constraints trivially satisfied:
      // the snapshot fields stay exactly as complete/consistent as
      // they already were.
      const updated = await this.prisma.opportunity.update({ where: { id }, data: baseData });
      await this.auditUpdate(id, ctx, who);
      return updated;
    }

    // SCHEDULED, ACTIVE, PAUSED — regenerate snapshots atomically, so
    // a stale snapshot can never sit alongside new data. The
    // share-tier POLICY VERSION stays pinned to whatever it already
    // was (existing.shareTierPolicyVersionId) — only the resulting
    // tier/percentage/shareQuantity are recomputed, against that SAME
    // pinned version's tiers.
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.opportunity.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== existing.status) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "This opportunity's status changed — please reload and try again"
        );
      }
      // ONLY WHERE A START IS STILL AHEAD. A SCHEDULED row whose
      // start_at has already passed is a row the worker is about to
      // activate, and editing it in that gap is a race. An offer
      // already ACTIVE or PAUSED has no such gap — it is through it.
      if (!onTheMarket && fresh.startAt <= new Date()) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "This opportunity's start time has passed and it can no longer be edited directly"
        );
      }

      let snapshotFields: SnapshotFields;
      try {
        snapshotFields = await this.computeSnapshotFields(tx, {
          productId,
          fulfillmentLocationId,
          unitPriceAmount,
          targetQuantity,
          saleMode: fresh.saleMode,
          pinnedShareTierPolicyVersionId: fresh.shareTierPolicyVersionId,
          pinnedCommissionPolicyVersionId: fresh.commissionPolicyVersionId,
        });
      } catch (err) {
        if (err instanceof PurchaseQuantityIncompatibleError) {
          throw new BusinessException(
            400,
            ERROR_CODES.VALIDATION_FAILED,
            this.formatIncompatibleQuantityMessage(err.suggestions)
          );
        }
        if (err instanceof TaxRateUnavailableError) {
          throw new BusinessException(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            "Tax configuration required to recompute this opportunity's snapshot is not currently available"
          );
        }
        throw err;
      }

      const updated = await tx.opportunity.update({
        where: { id },
        data: { ...baseData, ...snapshotFields },
      });

      await tx.auditLog.create({
        data: {
          actorType: who.actorType,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action: who.action,
          entityType: "opportunity",
          entityId: id,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "OPPORTUNITY_UPDATED", payload: { opportunityId: id } as Prisma.InputJsonValue },
      });

      return updated;
    });
  }

  /**
   * THE SAME EDIT, ASKED BY AN ADMINISTRATOR.
   *
   * IT SKIPS THE OWNERSHIP CHECK AND NOTHING ELSE. The company is
   * read from the offer itself rather than from a session, so every
   * check that follows — the branch is that supplier's, the product
   * is that supplier's, the buyer has not paid — is asked against
   * the right company, and an operator cannot point one supplier's
   * offer at another supplier's product.
   */
  async updateAsAdmin(
    id: string,
    dto: UpdateOpportunityDto,
    admin: { actorId: string; requestId: string; ipAddress?: string; userAgent?: string }
  ) {
    const row = await this.prisma.opportunity.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!row) throw new NotFoundException("Opportunity not found");

    return this.update(
      id,
      dto,
      {
        userId: admin.actorId,
        companyId: row.companyId,
        requestId: admin.requestId,
        ipAddress: admin.ipAddress,
        userAgent: admin.userAgent,
      },
      ADMIN_EDIT
    );
  }

  async deleteDraft(id: string, ctx: ActorContext): Promise<void> {
    const opp = await this.getOwned(id, ctx.companyId);
    if (opp.status !== OpportunityStatus.DRAFT) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Only a DRAFT opportunity can be deleted");
    }

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "OPPORTUNITY_DRAFT_DELETED",
      entityType: "opportunity",
      entityId: id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.prisma.opportunity.delete({ where: { id } });
  }

  async publish(id: string, ctx: ActorContext) {
    const existing = await this.getOwned(id, ctx.companyId);
    if (existing.status !== OpportunityStatus.DRAFT && existing.status !== OpportunityStatus.ACTION_REQUIRED) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Cannot publish an opportunity with status ${existing.status}`
      );
    }

    const full = await this.prisma.opportunity.findUniqueOrThrow({
      where: { id },
      include: {
        product: { select: { approvalStatus: true, archivedAt: true, taxonomyNodeId: true } },
        fulfillmentLocation: {
          select: {
            isActive: true,
            // The region decides; the city refines. Both are read
            // because both are checked — the region always, the city
            // only when the branch names one.
            region: { select: { isActive: true } },
            city: { select: { isActive: true } },
          },
        },
        company: {
          select: {
            verificationStatus: true,
            activeBankAccount: { select: { verificationStatus: true } },
            taxProfile: { select: { id: true } },
            invoicingProfile: { select: { id: true } },
          },
        },
      },
    });

    const blocker = evaluateLiveEligibility({
      company: full.company,
      product: full.product,
      fulfillmentLocation: full.fulfillmentLocation,
    });

    if (blocker) {
      return this.handlePublishBlocked(id, existing.status, blocker, ctx);
    }

    let snapshotFields: SnapshotFields;
    try {
      snapshotFields = await this.computeSnapshotFields(this.prisma, {
        productId: existing.productId,
        fulfillmentLocationId: existing.fulfillmentLocationId,
        unitPriceAmount: existing.unitPriceAmount.toFixed(2),
        targetQuantity: existing.targetQuantity,
        saleMode: existing.saleMode,
        // ACTION_REQUIRED rows already have a pinned version (they were
        // published once before); DRAFT rows have never had one, so
        // this naturally resolves to "first time -> current policy",
        // "republish -> same original policy" with zero extra logic.
        pinnedShareTierPolicyVersionId: existing.shareTierPolicyVersionId,
        pinnedCommissionPolicyVersionId: existing.commissionPolicyVersionId,
      });
    } catch (err) {
      if (err instanceof TaxRateUnavailableError) {
        const taxBlocker: Blocker = {
          code: "TAX_RATE_NOT_CONFIGURED",
          details: "Tax configuration required to publish is not currently available.",
        };
        return this.handlePublishBlocked(id, existing.status, taxBlocker, ctx);
      }
      if (err instanceof PurchaseQuantityIncompatibleError) {
        const quantityBlocker: Blocker = {
          code: "PURCHASE_QUANTITY_NOT_COMPATIBLE",
          details: this.formatIncompatibleQuantityMessage(err.suggestions),
        };
        return this.handlePublishBlocked(id, existing.status, quantityBlocker, ctx);
      }
      throw err;
    }

    return this.prisma.$transaction(async (tx) => {
      /**
       * ONE PRODUCT, ONE PUBLICATION AT A TIME — held on the product's
       * own row.
       *
       * WHY A LOCK AND NOT A CHECK. Two drafts on one product, published
       * in the same instant, both read "no live offer" and both write
       * one: the read and the write are not atomic on their own, and the
       * result is exactly the double-sell this rule exists to prevent.
       * The product row is the natural mutex — every offer on it passes
       * through here, and nothing else in the publish path touches it —
       * so the second request waits, then sees what the first committed.
       *
       * `FOR UPDATE` blocks writers, never readers: no page, no listing
       * and no buyer is slowed by this.
       *
       * NOT A DATABASE CONSTRAINT, deliberately. A partial unique index
       * over the live statuses would need a migration, and the owner's
       * rule is to stop before one. This is the same guarantee held in
       * the one transaction every publication already goes through.
       */
      await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${existing.productId}::uuid FOR UPDATE`;

      /**
       * THE ROW AS IT IS NOW, not as it was before the lock.
       *
       * `existing` was read outside this transaction. Two requests to
       * publish the SAME draft would both have seen DRAFT there; inside
       * the lock the second one sees what the first wrote, and refusing
       * is what stops a second activation, a second audit entry and a
       * second `firstActivatedAt` on one offer.
       */
      const claimed = await tx.opportunity.findUniqueOrThrow({
        where: { id },
        select: { status: true, startAt: true, endAt: true, firstActivatedAt: true },
      });

      if (
        claimed.status !== OpportunityStatus.DRAFT &&
        claimed.status !== OpportunityStatus.ACTION_REQUIRED
      ) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          `Cannot publish an opportunity with status ${claimed.status}`
        );
      }

      /**
       * THE OWNER'S RULE, enforced where it cannot be walked around:
       * «لا يُنشر عرض ثانٍ على المنتج إلا بعد انتهاء العرض الأول».
       *
       * The draft itself is never touched by this refusal. A supplier
       * may prepare the next offer while the current one runs and
       * publish it the moment that one ends — what is refused is the
       * publication, not the work.
       */
      const liveSibling = await tx.opportunity.findFirst({
        where: {
          productId: existing.productId,
          id: { not: id },
          status: { in: LIVE_STATUSES },
          /**
           * ONE LIVE LISTING PER PRODUCT, PER SALE MODE.
           *
           * «نفس المنتج يمكن أن يكون له بيع مباشر نشط وعرض جماعي نشط في
           *  الوقت نفسه.»
           *
           * The rule was always about two listings of the SAME KIND
           * competing for one product — two collective offers on the same
           * thing split the buyers and neither reaches its target. A
           * direct sale and a group offer do not compete that way: they
           * are two ways to buy the same product, with separate stock and
           * separate arithmetic, and the owner wants both available at
           * once.
           */
          saleMode: existing.saleMode,
        },
        select: { id: true, status: true },
        orderBy: { createdAt: "asc" },
      });

      if (liveSibling) {
        throw new BusinessException(
          409,
          ERROR_CODES.PRODUCT_ALREADY_HAS_LIVE_OFFER,
          `Product ${existing.productId} already has a live ${existing.saleMode} listing (${liveSibling.id}, ${liveSibling.status})`
        );
      }

      /**
       * THE WINDOW IS STAMPED HERE, on the publication that SUCCEEDED.
       *
       * The supplier answered "how many days", and the answer is carried
       * in the row as the DISTANCE between the pair written at creation.
       * This re-anchors that distance to right now, so an offer drafted
       * three weeks ago, or one whose publication was refused twice
       * before, runs its full period from the moment it actually became
       * buyable rather than opening already part-expired.
       *
       * INSIDE THE TRANSACTION, which is the whole point of moving it
       * here: a stamp written before a publication that then failed
       * would have started a clock on an offer nobody could buy.
       *
       * ONLY WHILE `firstActivatedAt` IS NULL. Once an offer has been
       * live, its window is frozen by a database trigger and may move
       * only through the single atomic extension path — a republish of
       * such a row keeps the instants it already has.
       */
      const stamped =
        existing.saleMode === "DIRECT"
          ? // A DIRECT LISTING HAS NO WINDOW TO RE-ANCHOR. Its
            // `start_at` is the moment it went on sale and its `end_at`
            // is NULL by constraint; the first publication stamps the
            // former and every later republish leaves it where it is.
            claimed.firstActivatedAt === null
            ? { startAt: new Date(), endAt: null }
            : null
          : claimed.firstActivatedAt === null
            ? windowFromNow(daysBetween(claimed.startAt, claimed.endAt!))
            : null;

      const effectiveStartAt = stamped ? stamped.startAt : claimed.startAt;
      /**
       * A SHELF OPENS WHEN IT IS PUBLISHED.
       *
       * SCHEDULED is a GROUP status: it exists because a collective
       * offer is announced for a window that has not opened yet, and
       * `opportunities_sale_mode_status` refuses it on a DIRECT row.
       * There is nothing to announce in advance about a fixed price and
       * a quantity — the supplier publishes when the goods are there.
       */
      const newStatus =
        existing.saleMode === "DIRECT" || effectiveStartAt <= new Date()
          ? OpportunityStatus.ACTIVE
          : OpportunityStatus.SCHEDULED;

      const data: Prisma.OpportunityUncheckedUpdateInput = {
        ...(stamped ? { startAt: stamped.startAt, endAt: stamped.endAt } : {}),
        status: newStatus,
        reasonCode: null,
        reasonDetails: null,
        blockedAt: null,
        fulfillmentCityId: snapshotFields.fulfillmentCityId,
        fulfillmentCityNameAr: snapshotFields.fulfillmentCityNameAr,
        fulfillmentCityNameEn: snapshotFields.fulfillmentCityNameEn,
        fulfillmentRegionId: snapshotFields.fulfillmentRegionId,
        fulfillmentRegionNameAr: snapshotFields.fulfillmentRegionNameAr,
        fulfillmentRegionNameEn: snapshotFields.fulfillmentRegionNameEn,
        productApprovalSnapshotId: snapshotFields.productApprovalSnapshotId,
        taxRatePercent: snapshotFields.taxRatePercent,
        unitPriceExclTaxAmount: snapshotFields.unitPriceExclTaxAmount,
        unitTaxAmount: snapshotFields.unitTaxAmount,
        taxCalculationRuleCode: snapshotFields.taxCalculationRuleCode,
        taxCalculationRuleVersion: snapshotFields.taxCalculationRuleVersion,
        totalValueInclTaxAmount: snapshotFields.totalValueInclTaxAmount,
        shareTierPolicyVersionId: snapshotFields.shareTierPolicyVersionId,
        shareTierIndex: snapshotFields.shareTierIndex,
        shareBasisPoints: snapshotFields.shareBasisPoints,
        shareQuantity: snapshotFields.shareQuantity,
        salesUnitNameAr: snapshotFields.salesUnitNameAr,
        salesUnitNameEn: snapshotFields.salesUnitNameEn,
        packageContentQuantity: snapshotFields.packageContentQuantity,
        packageContentUnitNameAr: snapshotFields.packageContentUnitNameAr,
        packageContentUnitNameEn: snapshotFields.packageContentUnitNameEn,
        commissionPolicyVersionId: snapshotFields.commissionPolicyVersionId,
        commissionRateBasisPoints: snapshotFields.commissionRateBasisPoints,
      };
      if (newStatus === OpportunityStatus.ACTIVE) {
        data.firstActivatedAt = new Date();
      }

      const updated = await tx.opportunity.update({ where: { id }, data });

      const action = newStatus === OpportunityStatus.ACTIVE ? "OPPORTUNITY_ACTIVATED" : "OPPORTUNITY_SCHEDULED";
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action,
          entityType: "opportunity",
          entityId: id,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: action,
          payload: { opportunityId: id } as Prisma.InputJsonValue,
          idempotencyKey: newStatus === OpportunityStatus.ACTIVE ? `OPPORTUNITY_ACTIVATED:${id}` : undefined,
        },
      });

      return updated;
    });
  }

  /**
   * Extends a live listing's end date.
   *
   * HOW MANY DAYS IS A SETTING. It was `INTERVAL '3 days'` written into
   * the statement below, so changing a commercial decision meant a
   * deploy. It is now `opportunity_settings.extensionDays`, read here
   * and bound as a parameter — never interpolated into the SQL text.
   *
   * HOW MANY TIMES IS NOT A SETTING, and cannot be made one without a
   * migration. `opportunities.extended_at` is a single nullable
   * timestamp: it records THAT a listing was extended and when, never
   * how often, and `extended_at IS NULL` in the statement below is the
   * atomic claim that makes two simultaneous requests unable to extend
   * the same listing twice. Counting from the audit log instead would
   * lose that atomicity — two requests would both read the same count
   * and both proceed — and the outbox event is keyed
   * `OPPORTUNITY_EXTENDED:{id}`, one per listing, so a second
   * extension could not be published anyway. Allowing more than one
   * needs a counter column or a row per extension, both of which are
   * schema changes.
   *
   * THE SETTING IS READ AT THE MOMENT OF THE EXTENSION, so changing it
   * never moves the end date of a listing already extended. Nothing
   * here re-applies a bound to an existing row.
   */
/**
   * CLOSE THE OFFER AT WHAT IT REACHED.
   *
   * «إذا قرر أن تقفل الصفقة ويعتمدها أوك» — the offer's window has run
   * out at, say, sixty per cent, the scheduler has opened the supplier's
   * twenty-four hours, and he takes the sixty rather than let it go.
   *
   * ONLY INSIDE THAT WINDOW. Before it there is nothing to decide, the
   * offer is still selling; after it the money is already on its way
   * back to the buyers and there is nothing left to close.
   *
   * IT IS THE SAME CLOSE THE TARGET WOULD HAVE CAUSED. Status FUNDED,
   * and every waiting share released through the SAME util the payment
   * webhook uses — so a buyer's preparation deadline does not depend on
   * which door the offer left by.
   *
   * THE COMMISSION IS UNTOUCHED HERE, and that is the owner's rule
   * — «تحسب العمولة على ما بيع فقط». It is computed per ORDER at
   * capture, on that order's own paid quantity, so an offer closing at
   * sixty per cent has already charged commission on sixty per cent and
   * nothing needs adjusting.
   */
  async closeAtReached(id: string, ctx: ActorContext) {
    const existing = await this.getOwned(id, ctx.companyId);
    // There is no target to fall short of on a shelf, so there is never
    // a decision to make about one.
    this.assertGroupOnly(existing.saleMode, "closed at what it reached");

    if (
      existing.decisionWindowClosesAt === null ||
      existing.decisionWindowClosesAt <= new Date()
    ) {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        "This opportunity has no open decision window"
      );
    }
    if (existing.fundedQuantity <= 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Nothing has been bought on this opportunity"
      );
    }

    const closedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // CLAIMED, NOT READ-THEN-WRITTEN: the scheduler is running every
      // minute and may be closing this same window as the supplier
      // presses. Whichever writes first wins, and the loser does
      // nothing rather than acting on a state that has moved.
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'FUNDED',
            decision_window_closes_at = NULL,
            updated_at = now()
        WHERE id = ${id}::uuid
          AND status IN ('ACTIVE', 'PAUSED')
          AND decision_window_closes_at IS NOT NULL
          AND decision_window_closes_at > now()
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "The decision window closed before this could be applied"
        );
      }

      const released = await releaseFundedAllocationsTx(tx, id, closedAt);

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action: "OPPORTUNITY_CLOSED_AT_REACHED",
          entityType: "opportunity",
          entityId: id,
          afterData: {
            fundedQuantity: existing.fundedQuantity,
            targetQuantity: existing.targetQuantity,
            releasedAllocations: released,
          } as Prisma.InputJsonValue,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "OPPORTUNITY_CLOSED_AT_REACHED",
          payload: { opportunityId: id, releasedAllocations: released } as Prisma.InputJsonValue,
          idempotencyKey: `OPPORTUNITY_CLOSED_AT_REACHED:${id}`,
        },
      });

      return tx.opportunity.findUniqueOrThrow({ where: { id } });
    });
  }

  async extend(id: string, ctx: ActorContext) {
    const existing = await this.getOwned(id, ctx.companyId);
    // NOTHING WITH NO WINDOW CAN BE EXTENDED. The database already
    // guarantees a DIRECT listing has neither `end_at` nor
    // `extended_at`; this says so in words rather than letting the
    // arithmetic below reach a NULL.
    this.assertGroupOnly(existing.saleMode, "extended");
    if (existing.status !== OpportunityStatus.ACTIVE) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Only an ACTIVE opportunity can be extended");
    }
    if (existing.extendedAt !== null) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "This opportunity has already been extended once");
    }
    // AND THE DECISION WINDOW IS EXACTLY WHEN AN EXTENSION IS WANTED.
    //
    // «فرصة وصلت ستين بالمئة… إذا أراد أن تكتمل مئة بالمئة فعنده خيار
    //  التمديد» — the offer's own window has closed by then, so refusing
    // every ended offer refused the one case the option exists for.
    //
    // STILL REFUSED ONCE THE 24 HOURS RUN OUT: by that point the money
    // is on its way back to the buyers and there is nothing to extend.
    const decisionWindowOpen =
      existing.decisionWindowClosesAt !== null &&
      existing.decisionWindowClosesAt > new Date();
    if (existing.endAt! <= new Date() && !decisionWindowOpen) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "This opportunity has already ended");
    }

    const { extensionDays } = await this.opportunitySettings.getConfig();

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET end_at = end_at + (${extensionDays}::int * INTERVAL '1 day'),
            extended_at = now(),
            updated_at = now()
        WHERE id = ${id}::uuid AND status = 'ACTIVE' AND extended_at IS NULL
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "Extension could not be applied — the opportunity may already be extended or no longer active"
        );
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action: "OPPORTUNITY_EXTENDED",
          entityType: "opportunity",
          entityId: id,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "OPPORTUNITY_EXTENDED",
          payload: { opportunityId: id } as Prisma.InputJsonValue,
          idempotencyKey: `OPPORTUNITY_EXTENDED:${id}`,
        },
      });

      return tx.opportunity.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * RAISE OR LOWER THE SHELF.
   *
   * «المورد يستطيع تعديل المخزون صعودًا أو هبوطًا بشرط
   *  `new target_quantity >= funded_quantity + activeLocks`، ويجب حماية
   *  ذلك بالقفل المناسب لمنع السباقات.»
   *
   * WHY THIS IS NOT `update()`. That path refuses every edit the moment
   * a buyer has committed — `assertNoBuyerCommitted` — and it is right
   * to: price, branch, description and days are what a buyer was shown.
   * Restocking is the opposite case. It is the normal life of a direct
   * listing, it happens precisely BECAUSE units have been sold, and
   * nothing a previous buyer agreed to changes when the shelf is
   * refilled.
   *
   * THE FLOOR, AND WHY IT NEEDS THE LOCK. Three numbers decide it, and
   * two of them move under the supplier's feet: another buyer can pay
   * (raising `funded_quantity`) or open a basket (raising the live
   * locks) between reading the row and writing it. Reading them inside
   * `SELECT ... FOR UPDATE` on the offer — the same lock the checkout
   * takes, in the same order — makes the decision and the write one
   * indivisible step: a checkout that arrives mid-way waits, then sees
   * the new shelf; one that got there first is counted here.
   *
   * THE DATABASE HOLDS HALF OF IT TOO.
   * `prevent_opportunity_core_field_change` refuses any DIRECT stock
   * below `funded_quantity` whatever writes it, and
   * `opportunities_funded_within_target` says the same as a CHECK. The
   * locks are the part only a transaction can see, which is why that
   * half lives here.
   */
  async setDirectStock(id: string, dto: SetDirectStockDto, ctx: ActorContext) {
    const existing = await this.getOwned(id, ctx.companyId);
    if (existing.saleMode !== "DIRECT") {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Stock belongs to a direct sale — a group offer's target is fixed once it is published"
      );
    }
    if (
      existing.status !== OpportunityStatus.ACTIVE &&
      existing.status !== OpportunityStatus.PAUSED &&
      existing.status !== OpportunityStatus.DRAFT &&
      existing.status !== OpportunityStatus.ACTION_REQUIRED
    ) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Cannot change the stock of a listing with status ${existing.status}`
      );
    }

    const settings = await this.opportunitySettings.getConfig();
    if (
      dto.targetQuantity < settings.minTargetQuantity ||
      dto.targetQuantity > settings.maxTargetQuantity
    ) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Stock must be between ${settings.minTargetQuantity} and ${settings.maxTargetQuantity}`
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // THE SAME LOCK, IN THE SAME ORDER as the checkout takes it:
      // opportunity first. Two paths that locked in different orders
      // would deadlock on each other under exactly the load this exists
      // to survive.
      const rows = await tx.$queryRaw<
        { id: string; sale_mode: string; status: string; funded_quantity: number; target_quantity: number }[]
      >`
        SELECT id, sale_mode, status, funded_quantity, target_quantity
        FROM opportunities WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (rows.length === 0) throw new NotFoundException("Opportunity not found");
      const row = rows[0];

      /**
       * EVERY BASKET THAT HAS NOT BEEN RELEASED — a WIDER set than the
       * one the checkout subtracts, and deliberately so.
       *
       * The checkout counts only LIVE locks: LOCKED before its expiry,
       * PAYMENT_PENDING before its deadline. That is right for SELLING —
       * an expired basket's stock goes back on the shelf for the next
       * buyer.
       *
       * IT IS WRONG FOR TAKING THE SHELF AWAY, because an expired lock
       * that nothing has released yet can still come back to life.
       * `PaymentAttemptService.startPayment` claims a session on
       * `status = 'LOCKED'` alone — it never compares `lock_expires_at`
       * to now — so a basket whose minute ran out a second ago, and
       * which the sweep has not reached, can still become
       * PAYMENT_PENDING with a fresh deadline and then be PAID.
       *
       * WHAT THAT WOULD COST, counted honestly: lower the shelf to the
       * live floor in that window, let the resurrected basket pay, and
       * the webhook's `funded += locked` lands above `target_quantity`,
       * where `opportunities_funded_within_target` refuses it — inside
       * the capture's own transaction. Money taken, no order written,
       * and a provider redelivering the same event for ever.
       *
       * SO THE FLOOR COUNTS WHAT COULD STILL BE CLAIMED, not what is
       * claimed right now. It costs the supplier nothing but a minute:
       * the sweep releases a genuinely dead basket and the floor drops
       * with it. Selling is untouched — the checkout keeps its own,
       * narrower reading, or an expired basket would block the next
       * buyer instead of the supplier.
       */
      const lockedRows = await tx.$queryRaw<{ sum: number | null }[]>`
        SELECT COALESCE(SUM(locked_quantity), 0)::int AS sum FROM checkout_sessions
        WHERE opportunity_id = ${id}::uuid AND lock_released_at IS NULL
          AND status IN ('LOCKED', 'PAYMENT_PENDING')
      `;
      const activeLockedQuantity = lockedRows[0].sum ?? 0;
      const floor = minimumDirectStock({
        fundedQuantity: row.funded_quantity,
        activeLockedQuantity,
      });

      if (dto.targetQuantity < floor) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          `Stock cannot go below ${floor}: ${row.funded_quantity} already sold and ${activeLockedQuantity} held in open baskets`
        );
      }

      /**
       * AND THE SAME FIGURE, ONE MORE TIME, AS THE ROW SEES IT.
       *
       * `row` was read at the top of this transaction under the offer's
       * own `FOR UPDATE`, so nothing can have changed `funded_quantity`
       * since — every writer of it takes that same lock first, in that
       * same order. This re-reads it anyway, because the claim being
       * made here is about MONEY and the cost of being wrong is a
       * capture the database has to refuse.
       *
       * The database says it a third time:
       * `opportunities_funded_within_target` is a CHECK, and
       * `prevent_opportunity_core_field_change` refuses a DIRECT shelf
       * below what has sold whatever writes it. Three statements of one
       * rule, none of which is decoration: this one names the number in
       * words, the CHECK survives a bug in this file, and the trigger
       * survives a hand-written UPDATE.
       */
      if (dto.targetQuantity < row.funded_quantity) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          `Stock cannot go below ${row.funded_quantity}, which has already been sold`
        );
      }

      await tx.$executeRaw`
        UPDATE opportunities SET target_quantity = ${dto.targetQuantity}, updated_at = now()
        WHERE id = ${id}::uuid
      `;

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action: "DIRECT_LISTING_STOCK_CHANGED",
          entityType: "opportunity",
          entityId: id,
          beforeData: { targetQuantity: row.target_quantity },
          afterData: { targetQuantity: dto.targetQuantity },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      const updated = await tx.opportunity.findUniqueOrThrow({
        where: { id },
        select: SUPPLIER_OPPORTUNITY_DETAIL_SELECT,
      });
      return {
        ...toSupplierOpportunityDetail(updated),
        availableQuantity: availableQuantity({
          targetQuantity: dto.targetQuantity,
          fundedQuantity: row.funded_quantity,
          activeLockedQuantity,
        }),
      };
    });
  }

  /**
   * STOP SELLING. WHAT WAS SOLD IS UNTOUCHED.
   *
   * «إذا حصلت مبيعات على DIRECT لا تعدل السعر على النشرة الحالية —
   *  يوقف المورد النشرة وينشئ واحدة جديدة بالسعر الجديد.»
   *
   * THIS IS THE PRICE CHANGE, and it is deliberately not one. The price
   * and its tax breakdown are frozen on a row the moment it takes money,
   * by a database trigger, for both modes — an order, an invoice and a
   * settlement all point back at that row and read it as the terms of a
   * sale that already happened. Editing it would rewrite what a buyer
   * agreed to. So the supplier ends this listing and publishes another.
   *
   * AND NOBODY IS REFUNDED. This is what separates it from the
   * administrator's `cancel`, which refuses outright when paid orders
   * exist, and from `cancelAndRefund`, which gives the money back. In a
   * GROUP offer a cancellation strands buyers who paid and are waiting
   * for a target that will now never be reached — their money must come
   * back. In a DIRECT sale every paid order went to preparation the
   * moment it was paid; it is being packed, shipped and settled, and
   * has nothing to do with whether the shelf stays open.
   *
   * THE OPEN BASKETS DO GO, exactly as any cancellation releases them:
   * a session holding stock on a listing that is closing would hold it
   * for the whole of its lock and give it to nobody. A payment that
   * arrives for one of them afterwards is refunded by the webhook's own
   * late-capture rule (`LATE_CAPTURE_AFTER_CANCEL`), which is where that
   * decision already lives.
   */
  async stopDirect(id: string, ctx: ActorContext) {
    const existing = await this.getOwned(id, ctx.companyId);
    if (existing.saleMode !== "DIRECT") {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Only a direct listing is stopped this way — a group offer is ended by its window or by an administrator"
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // CLAIMED, NOT READ-THEN-WRITTEN. Two presses of the same button,
      // or a press racing an administrator's pause, must produce one
      // cancellation and one audit entry.
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET status = 'CANCELLED', updated_at = now()
        WHERE id = ${id}::uuid AND status IN ('ACTIVE', 'PAUSED')
        RETURNING id
      `;
      if (claimed.length === 0) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          `A listing with status ${existing.status} is not on sale and cannot be stopped`
        );
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action: "DIRECT_LISTING_STOPPED",
          entityType: "opportunity",
          entityId: id,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "DIRECT_LISTING_STOPPED",
          payload: { opportunityId: id } as Prisma.InputJsonValue,
        },
      });

      await releaseActiveLocksForOpportunityTx(tx, id);

      const updated = await tx.opportunity.findUniqueOrThrow({
        where: { id },
        select: SUPPLIER_OPPORTUNITY_DETAIL_SELECT,
      });
      return toSupplierOpportunityDetail(updated);
    });
  }

  /**
   * One sentence, said the same way wherever a GROUP-only action is
   * asked of a direct listing.
   */
  private assertGroupOnly(saleMode: SaleMode, action: string): void {
    if (saleMode === "DIRECT") {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `A direct sale has no sales window and no collective target, so it cannot be ${action}`
      );
    }
  }

  private async handlePublishBlocked(
    id: string,
    fromStatus: OpportunityStatus,
    blocker: Blocker,
    ctx: ActorContext
  ): Promise<never> {
    if (fromStatus === OpportunityStatus.ACTION_REQUIRED) {
      await this.prisma.$transaction(async (tx) => {
        await tx.opportunity.update({
          where: { id },
          data: { reasonCode: blocker.code, reasonDetails: blocker.details, blockedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            actorType: AuditActorType.USER,
            actorId: ctx.userId,
            companyId: ctx.companyId,
            action: "OPPORTUNITY_REPUBLISH_BLOCKED",
            entityType: "opportunity",
            entityId: id,
            reason: blocker.details,
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      });
    }

    const status = blocker.code === "SUPPLIER_NOT_VERIFIED" ? 403 : 400;
    const code =
      blocker.code === "SUPPLIER_NOT_VERIFIED" ? ERROR_CODES.SUPPLIER_NOT_VERIFIED : ERROR_CODES.VALIDATION_FAILED;
    throw new BusinessException(status, code, blocker.details);
  }

  private async computeSnapshotFields(
    tx: Tx,
    params: {
      productId: string;
      fulfillmentLocationId: string;
      /** Canonical decimal string at scale 2. Never a number. */
      unitPriceAmount: string;
      targetQuantity: number;
      /**
       * WHICH ARITHMETIC APPLIES. Everything in this function except the
       * share tier is identical for both modes — the branch, the region,
       * the approved product snapshot, the tax breakdown, the sales unit
       * names and the commission are what an ORDER is built from, and a
       * DIRECT sale produces exactly the same order as a GROUP one.
       */
      saleMode: SaleMode;
      pinnedShareTierPolicyVersionId: string | null;
      pinnedCommissionPolicyVersionId: string | null;
    }
  ): Promise<SnapshotFields> {
    const location = await tx.companyLocation.findUniqueOrThrow({
      where: { id: params.fulfillmentLocationId },
      // THE REGION COMES FROM THE BRANCH ITSELF, not through its city.
      // A branch has a region always and a city sometimes, so reading
      // the region via `city.region` would leave a branch with no city
      // unable to publish at all.
      include: { region: true, city: true },
    });
    const product = await tx.product.findUniqueOrThrow({ where: { id: params.productId } });

    const latestSnapshot = await tx.productApprovalSnapshot.findFirst({
      where: { productId: params.productId },
      orderBy: { approvedAt: "desc" },
    });
    if (!latestSnapshot) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "This product has no approved snapshot to build an opportunity on"
      );
    }

    const taxResult = await this.taxRateProvider.getApplicableRate({
      productId: params.productId,
      taxonomyNodeId: product.taxonomyNodeId,
    });
    if (!taxResult) {
      throw new TaxRateUnavailableError();
    }

    // Decimal strings in, decimal strings out. The rate is canonicalised
    // to the scale its own column holds — `Decimal(5,2)` — so a stored
    // setting of `15` and one of `15.00` produce the same snapshot.
    const tax = computeTaxSnapshot({
      unitPriceInclTax: params.unitPriceAmount,
      ratePercent: new Prisma.Decimal(String(taxResult.ratePercent)).toFixed(2),
      ruleCode: taxResult.ruleCode,
      ruleVersion: taxResult.ruleVersion,
    });

    // Sales unit + package content — read EXCLUSIVELY from the frozen
    // ProductApprovalSnapshot.snapshot JSON, never from a live
    // Product join. Historical-compatibility: a pre-7A snapshot only
    // has salesUnitId (no names) — its name is resolved live exactly
    // ONCE, right now, and frozen forever on the opportunity from
    // this point on. The stored snapshot itself is NEVER rewritten
    // (it is append-only/immutable at the DB level) — this is a
    // read-time fallback only.
    const snapshotPayload = latestSnapshot.snapshot as Record<string, unknown>;
    let salesUnitNameAr: string;
    let salesUnitNameEn: string;
    let packageContentQuantity: number | null = null;
    let packageContentUnitNameAr: string | null = null;
    let packageContentUnitNameEn: string | null = null;

    if (isLegacySnapshotShape(snapshotPayload)) {
      const legacyUnit = await tx.salesUnit.findUnique({ where: { id: snapshotPayload.salesUnitId } });
      if (!legacyUnit) {
        throw new Error(
          `Sales unit ${snapshotPayload.salesUnitId} referenced by the legacy product snapshot ${latestSnapshot.id} no longer exists — refusing to guess`
        );
      }
      salesUnitNameAr = legacyUnit.nameAr;
      salesUnitNameEn = legacyUnit.nameEn;
      // Legacy snapshots never captured package content at all.
    } else {
      const nameAr = snapshotPayload.salesUnitNameAr;
      const nameEn = snapshotPayload.salesUnitNameEn;
      if (typeof nameAr !== "string" || typeof nameEn !== "string") {
        throw new Error(
          `Product approval snapshot ${latestSnapshot.id} has neither a legacy salesUnitId nor salesUnitNameAr/En — cannot build an opportunity on it`
        );
      }
      salesUnitNameAr = nameAr;
      salesUnitNameEn = nameEn;
      const qty = snapshotPayload.packageContentQuantity;
      const unitAr = snapshotPayload.packageContentUnitNameAr;
      const unitEn = snapshotPayload.packageContentUnitNameEn;
      if (qty !== null && qty !== undefined && typeof unitAr === "string" && typeof unitEn === "string") {
        packageContentQuantity = Number(qty);
        packageContentUnitNameAr = unitAr;
        packageContentUnitNameEn = unitEn;
      }
    }

    // Share-tier — GROUP ONLY.
    //
    // A DIRECT listing has no tier to select and no share to divide
    // into: the buyer names the quantity they want, bounded only by
    // what is left on the shelf. Running the tier arithmetic anyway and
    // discarding the result would also mean a DIRECT listing could be
    // REFUSED at publish by `PurchaseQuantityIncompatibleError` — a
    // rule about dividing a target into equal shares, applied to a
    // listing that never divides anything.
    const share = params.saleMode === "DIRECT" ? null : await this.computeShareSnapshot(params);

    // Commission — same pinning philosophy as the share-tier policy:
    // Version+Rate are frozen here; the actual commission AMOUNT is
    // never computed or stored on the opportunity — only per-Order,
    // on that order's paid quantity, in Phase 7C.
    const commissionPolicy = params.pinnedCommissionPolicyVersionId
      ? await this.commissionPolicy.getPolicyByVersionId(params.pinnedCommissionPolicyVersionId)
      : await this.commissionPolicy.getCurrentPolicy();

    return {
      // THE CITY IS OPTIONAL AND SNAPSHOT AS NULL WHEN ABSENT, never
      // substituted with the Sentinel or with the region's name. A
      // listing that names no city is telling the truth; one that
      // borrows a name is not, and the shipping tier reads these.
      fulfillmentCityId: location.city?.id ?? null,
      fulfillmentCityNameAr: location.city?.nameAr ?? null,
      fulfillmentCityNameEn: location.city?.nameEn ?? null,
      fulfillmentRegionId: location.region.id,
      fulfillmentRegionNameAr: location.region.nameAr,
      fulfillmentRegionNameEn: location.region.nameEn,
      productApprovalSnapshotId: latestSnapshot.id,
      taxRatePercent: tax.taxRatePercent,
      unitPriceExclTaxAmount: tax.unitPriceExclTaxAmount,
      unitTaxAmount: tax.unitTaxAmount,
      taxCalculationRuleCode: tax.taxCalculationRuleCode,
      taxCalculationRuleVersion: tax.taxCalculationRuleVersion,
      totalValueInclTaxAmount: share?.totalValueInclTaxAmount ?? null,
      shareTierPolicyVersionId: share?.shareTierPolicyVersionId ?? null,
      shareTierIndex: share?.shareTierIndex ?? null,
      shareBasisPoints: share?.shareBasisPoints ?? null,
      shareQuantity: share?.shareQuantity ?? null,
      salesUnitNameAr,
      salesUnitNameEn,
      packageContentQuantity,
      packageContentUnitNameAr,
      packageContentUnitNameEn,
      commissionPolicyVersionId: commissionPolicy.id,
      commissionRateBasisPoints: commissionPolicy.rateBasisPoints,
    };
  }

  /**
   * The collective offer's own arithmetic, unchanged and now in one
   * place.
   *
   * Lifted out of `computeSnapshotFields` verbatim so that the DIRECT
   * path can skip it without a flag threaded through the middle of a
   * two-hundred-line function.
   */
  private async computeShareSnapshot(params: {
    unitPriceAmount: string;
    targetQuantity: number;
    pinnedShareTierPolicyVersionId: string | null;
  }): Promise<{
    totalValueInclTaxAmount: string;
    shareTierPolicyVersionId: string;
    shareTierIndex: number;
    shareBasisPoints: number;
    shareQuantity: number;
  }> {
    // The pinned policy version (if any) is used as-is, never
    // re-resolved to "whatever is current" on a SCHEDULED edit or
    // ACTION_REQUIRED republish.
    const policy = params.pinnedShareTierPolicyVersionId
      ? await this.shareTierSettings.getPolicyByVersionId(params.pinnedShareTierPolicyVersionId)
      : await this.shareTierSettings.getCurrentPolicy();

    const totalValueDecimal = new Prisma.Decimal(params.targetQuantity).mul(params.unitPriceAmount);

    /**
     * THRESHOLD SELECTION ONLY.
     *
     * `selectTier` compares the total against the policy's upper bounds
     * and returns an INDEX. Its result is never written to a money column
     * and never enters an amount — `totalValueInclTaxAmount` below is
     * written from `totalValueDecimal`, not from this.
     *
     * Safe because the comparison cannot flip: a `Decimal(14,2)` total
     * tops out near 1e12, and a double represents every 2-decimal value
     * exactly up to `MAX_SAFE_INTEGER / 100` ≈ 9.0e13 — about ninety times
     * further out. Verified empirically in
     * `supplier-opportunity.precision.spec.ts`, which finds zero tier
     * flips across the quantity and price ranges this platform allows.
     */
    const totalValueForTierSelection = totalValueDecimal.toNumber();
    const { tierIndex, tier } = selectTier(
      { tiers: policy.tiers as ShareTier[] },
      totalValueForTierSelection
    );
    const shareQuantity = computeShareQuantity(params.targetQuantity, tier.shareBasisPoints);

    if (shareQuantity === null) {
      const opportunitySettings = await this.opportunitySettings.getConfig();
      // Also threshold-only: this returns candidate QUANTITIES to suggest
      // in an error message. No amount is derived from it and nothing it
      // produces is stored.
      const suggestions = suggestCompatibleQuantities(
        { tiers: policy.tiers as ShareTier[] },
        Number(params.unitPriceAmount),
        params.targetQuantity,
        opportunitySettings.maxTargetQuantity
      );
      throw new PurchaseQuantityIncompatibleError(suggestions);
    }

    return {
      // From the exact Decimal, never from the number used above for tier
      // selection. This one is a stored amount.
      totalValueInclTaxAmount: totalValueDecimal.toFixed(2),
      shareTierPolicyVersionId: policy.id,
      shareTierIndex: tierIndex,
      shareBasisPoints: tier.shareBasisPoints,
      shareQuantity,
    };
  }

  private formatIncompatibleQuantityMessage(suggestions: { below: number | null; above: number | null }): string {
    const parts: string[] = [];
    if (suggestions.below !== null) parts.push(`${suggestions.below} (lower)`);
    if (suggestions.above !== null) parts.push(`${suggestions.above} (higher)`);
    const suggestionText = parts.length > 0 ? ` Try: ${parts.join(" or ")}.` : "";
    return `The target quantity cannot be evenly split into whole shares under the current policy.${suggestionText}`;
  }

  private async requireOwnedProduct(productId: string, companyId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, companyId } });
    if (!product) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid product");
    }
  }

  private async requireOwnedLocation(locationId: string, companyId: string): Promise<void> {
    const location = await this.prisma.companyLocation.findFirst({
      where: { id: locationId, companyId, isActive: true },
    });
    if (!location) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid fulfillment location");
    }
  }

  private async validateOperationalBounds(fields: {
    targetQuantity: number;
    startAt: Date;
    /** NULL for a direct sale, which has no window to bound. */
    endAt: Date | null;
  }): Promise<void> {
    const settings = await this.opportunitySettings.getConfig();

    // THE DURATION RULES APPLY TO A WINDOW, and a direct sale has none.
    // The quantity bounds below apply to both: they are about how much
    // one listing may be about, which is as true of a shelf as it is of
    // a collective target.
    if (fields.endAt !== null) {
      const durationHours = (fields.endAt.getTime() - fields.startAt.getTime()) / (1000 * 60 * 60);
      if (durationHours < settings.minDurationHours) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Duration must be at least ${settings.minDurationHours} hours`
        );
      }
      if (durationHours > settings.maxDurationDays * 24) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Duration must not exceed ${settings.maxDurationDays} days`
        );
      }
    }
    if (fields.targetQuantity < settings.minTargetQuantity || fields.targetQuantity > settings.maxTargetQuantity) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Target quantity must be between ${settings.minTargetQuantity} and ${settings.maxTargetQuantity}`
      );
    }
  }

  private async auditUpdate(
    id: string,
    ctx: ActorContext,
    who: EditingActor
  ): Promise<void> {
    await this.audit.log({
      actorType: who.actorType,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: who.action,
      entityType: "opportunity",
      entityId: id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
