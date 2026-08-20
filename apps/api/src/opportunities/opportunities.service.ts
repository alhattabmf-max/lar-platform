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
  type ShareTier,
} from "@platform/domain";
import { evaluateLiveEligibility, type Blocker } from "@platform/opportunity-lifecycle";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OpportunitySettingsService } from "../settings/opportunity-settings.service";
import { ShareTierSettingsService } from "../settings/share-tier-settings.service";
import { CommissionPolicyService } from "../settings/commission-policy.service";
import { isLegacySnapshotShape } from "../products/product-snapshot.util";
import { TAX_RATE_PROVIDER, type TaxRateProvider } from "../tax/tax-rate-provider.interface";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { CreateOpportunityDto } from "./dto/create-opportunity.dto";
import type { UpdateOpportunityDto } from "./dto/update-opportunity.dto";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface SnapshotFields {
  fulfillmentCityId: string;
  fulfillmentCityNameAr: string;
  fulfillmentCityNameEn: string;
  fulfillmentRegionId: string;
  fulfillmentRegionNameAr: string;
  fulfillmentRegionNameEn: string;
  productApprovalSnapshotId: string;
  taxRatePercent: number;
  unitPriceExclTaxAmount: number;
  unitTaxAmount: number;
  taxCalculationRuleCode: string;
  taxCalculationRuleVersion: string;
  totalValueInclTaxAmount: number;
  shareTierPolicyVersionId: string;
  shareTierIndex: number;
  shareBasisPoints: number;
  shareQuantity: number;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  packageContentQuantity: number | null;
  packageContentUnitNameAr: string | null;
  packageContentUnitNameEn: string | null;
  commissionPolicyVersionId: string;
  commissionRateBasisPoints: number;
}

const EDITABLE_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.DRAFT,
  OpportunityStatus.SCHEDULED,
  OpportunityStatus.ACTION_REQUIRED,
];

class TaxRateUnavailableError extends Error {}

class PurchaseQuantityIncompatibleError extends Error {
  constructor(public readonly suggestions: { below: number | null; above: number | null }) {
    super("Purchase quantity is not compatible with the current share-tier policy");
  }
}

export interface SupplierOpportunityView {
  id: string;
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
  /** Computed from shareBasisPoints — the raw basis points value and shareTierPolicyVersionId are NEVER exposed, even to the owning supplier. */
  sharePercentage: number | null;
  shareQuantity: number | null;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Every supplier-facing controller response goes through this — never
 * a raw Prisma row. Deliberately omits: shareTierPolicyVersionId,
 * shareTierIndex, shareBasisPoints (replaced by a computed
 * sharePercentage), fulfillmentCityId, fulfillmentRegionId,
 * fulfillmentRegionId, productApprovalSnapshotId,
 * commissionPolicyVersionId,
 * companyId — internal FKs and raw policy internals with no reason to
 * ever leave the server, even to the opportunity's own owner.
 */
export function toSupplierOpportunityView(row: {
  id: string;
  productId: string;
  fulfillmentLocationId: string;
  targetQuantity: number;
  fundedQuantity: number;
  unitPriceAmount: Prisma.Decimal;
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
  taxRatePercent: Prisma.Decimal | null;
  unitPriceExclTaxAmount: Prisma.Decimal | null;
  unitTaxAmount: Prisma.Decimal | null;
  totalValueInclTaxAmount: Prisma.Decimal | null;
  shareBasisPoints: number | null;
  shareQuantity: number | null;
  salesUnitNameAr: string | null;
  salesUnitNameEn: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SupplierOpportunityView {
  return {
    id: row.id,
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

  async listMine(companyId: string) {
    return this.prisma.opportunity.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });
  }

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

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    await this.validateOperationalBounds({ targetQuantity: dto.targetQuantity, startAt, endAt });

    const opp = await this.prisma.opportunity.create({
      data: {
        companyId: ctx.companyId,
        productId: dto.productId,
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
   * ACTIVE and beyond: not editable here (the DB trigger would reject
   * core-field changes anyway; this gives a clean error first).
   */
  async update(id: string, dto: UpdateOpportunityDto, ctx: ActorContext) {
    const existing = await this.getOwned(id, ctx.companyId);

    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Cannot edit an opportunity with status ${existing.status}`
      );
    }

    const productId = dto.productId ?? existing.productId;
    const fulfillmentLocationId = dto.fulfillmentLocationId ?? existing.fulfillmentLocationId;
    const unitPriceAmount = dto.unitPriceAmount ?? existing.unitPriceAmount.toNumber();
    const targetQuantity = dto.targetQuantity ?? existing.targetQuantity;
    const startAt = dto.startAt ? new Date(dto.startAt) : existing.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : existing.endAt;

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
      await this.auditUpdate(id, ctx);
      return updated;
    }

    // SCHEDULED — regenerate snapshots atomically, since a SCHEDULED
    // row's snapshot must stay in sync with any live edit made before
    // it becomes due. The share-tier POLICY VERSION stays pinned to
    // whatever it already was (existing.shareTierPolicyVersionId) —
    // only the resulting tier/percentage/shareQuantity are
    // recomputed, against that SAME pinned version's tiers.
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.opportunity.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== existing.status) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "This opportunity's status changed — please reload and try again"
        );
      }
      if (fresh.startAt <= new Date()) {
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
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action: "OPPORTUNITY_UPDATED",
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
        fulfillmentLocation: { select: { isActive: true, city: { select: { isActive: true } } } },
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
        unitPriceAmount: existing.unitPriceAmount.toNumber(),
        targetQuantity: existing.targetQuantity,
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

    const newStatus = full.startAt <= new Date() ? OpportunityStatus.ACTIVE : OpportunityStatus.SCHEDULED;

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.OpportunityUncheckedUpdateInput = {
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

  async extend(id: string, ctx: ActorContext) {
    const existing = await this.getOwned(id, ctx.companyId);
    if (existing.status !== OpportunityStatus.ACTIVE) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Only an ACTIVE opportunity can be extended");
    }
    if (existing.extendedAt !== null) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "This opportunity has already been extended once");
    }
    if (existing.endAt <= new Date()) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "This opportunity has already ended");
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE opportunities
        SET end_at = end_at + INTERVAL '3 days', extended_at = now(), updated_at = now()
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
      unitPriceAmount: number;
      targetQuantity: number;
      pinnedShareTierPolicyVersionId: string | null;
      pinnedCommissionPolicyVersionId: string | null;
    }
  ): Promise<SnapshotFields> {
    const location = await tx.companyLocation.findUniqueOrThrow({
      where: { id: params.fulfillmentLocationId },
      include: { city: { include: { region: true } } },
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

    const tax = computeTaxSnapshot({
      unitPriceInclTax: params.unitPriceAmount,
      ratePercent: taxResult.ratePercent,
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

    // Share-tier — exact Decimal multiplication for the total value;
    // the pinned policy version (if any) is used as-is, never
    // re-resolved to "whatever is current" on a SCHEDULED edit or
    // ACTION_REQUIRED republish.
    const policy = params.pinnedShareTierPolicyVersionId
      ? await this.shareTierSettings.getPolicyByVersionId(params.pinnedShareTierPolicyVersionId)
      : await this.shareTierSettings.getCurrentPolicy();

    const totalValueDecimal = new Prisma.Decimal(params.targetQuantity).mul(params.unitPriceAmount);
    const totalValueNumber = totalValueDecimal.toNumber();
    const { tierIndex, tier } = selectTier({ tiers: policy.tiers as ShareTier[] }, totalValueNumber);
    const shareQuantity = computeShareQuantity(params.targetQuantity, tier.shareBasisPoints);

    if (shareQuantity === null) {
      const opportunitySettings = await this.opportunitySettings.getConfig();
      const suggestions = suggestCompatibleQuantities(
        { tiers: policy.tiers as ShareTier[] },
        params.unitPriceAmount,
        params.targetQuantity,
        opportunitySettings.maxTargetQuantity
      );
      throw new PurchaseQuantityIncompatibleError(suggestions);
    }

    // Commission — same pinning philosophy as the share-tier policy:
    // Version+Rate are frozen here; the actual commission AMOUNT is
    // never computed or stored on the opportunity — only per-Order,
    // on that order's paid quantity, in Phase 7C.
    const commissionPolicy = params.pinnedCommissionPolicyVersionId
      ? await this.commissionPolicy.getPolicyByVersionId(params.pinnedCommissionPolicyVersionId)
      : await this.commissionPolicy.getCurrentPolicy();

    return {
      fulfillmentCityId: location.city.id,
      fulfillmentCityNameAr: location.city.nameAr,
      fulfillmentCityNameEn: location.city.nameEn,
      fulfillmentRegionId: location.city.region.id,
      fulfillmentRegionNameAr: location.city.region.nameAr,
      fulfillmentRegionNameEn: location.city.region.nameEn,
      productApprovalSnapshotId: latestSnapshot.id,
      taxRatePercent: tax.taxRatePercent,
      unitPriceExclTaxAmount: tax.unitPriceExclTaxAmount,
      unitTaxAmount: tax.unitTaxAmount,
      taxCalculationRuleCode: tax.taxCalculationRuleCode,
      taxCalculationRuleVersion: tax.taxCalculationRuleVersion,
      totalValueInclTaxAmount: totalValueNumber,
      shareTierPolicyVersionId: policy.id,
      shareTierIndex: tierIndex,
      shareBasisPoints: tier.shareBasisPoints,
      shareQuantity,
      salesUnitNameAr,
      salesUnitNameEn,
      packageContentQuantity,
      packageContentUnitNameAr,
      packageContentUnitNameEn,
      commissionPolicyVersionId: commissionPolicy.id,
      commissionRateBasisPoints: commissionPolicy.rateBasisPoints,
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
    endAt: Date;
  }): Promise<void> {
    const settings = await this.opportunitySettings.getConfig();

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
    if (fields.targetQuantity < settings.minTargetQuantity || fields.targetQuantity > settings.maxTargetQuantity) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Target quantity must be between ${settings.minTargetQuantity} and ${settings.maxTargetQuantity}`
      );
    }
  }

  private async auditUpdate(id: string, ctx: ActorContext): Promise<void> {
    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "OPPORTUNITY_UPDATED",
      entityType: "opportunity",
      entityId: id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
