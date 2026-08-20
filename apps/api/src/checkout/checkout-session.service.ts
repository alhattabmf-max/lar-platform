import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { AccountType, AuditActorType, Prisma } from "@prisma/client";
import { resolveShippingTier, feeForTier, computeCheckoutCooldown } from "@platform/domain";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { ShippingTariffPolicyService } from "../settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../settings/checkout-settings.service";
import type { CreateCheckoutSessionDto } from "./dto/create-checkout-session.dto";

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const MAX_IDEMPOTENCY_RETRY = 3;
const IDEMPOTENCY_TTL_HOURS = 1;

/**
 * The single service owning the full Checkout lifecycle for 7B:
 * idempotent creation (Idempotency-Key via the shared idempotency_keys
 * table, scoped per trader company), the atomic quantity lock, Quote
 * building from FROZEN Opportunity fields only (never a live tax
 * recompute), branch allocation, and lock release (voluntary or
 * expiry). No Order/Payment concept exists here — that is 7C.
 */
@Injectable()
export class CheckoutSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shippingTariff: ShippingTariffPolicyService,
    private readonly checkoutSettings: CheckoutSettingsService
  ) {}

  async create(dto: CreateCheckoutSessionDto, idempotencyKey: string, ctx: ActorContext) {
    const scope = `TRADER_CHECKOUT_CREATE:${ctx.companyId}`;
    const requestHash = createHash("sha256").update(JSON.stringify(canonicalize(dto))).digest("hex");

    for (let attempt = 0; attempt < MAX_IDEMPOTENCY_RETRY; attempt++) {
      // Priced OUTSIDE any row lock, on every attempt — a stale price
      // from a prior failed attempt is never reused.
      const pricing = await this.priceCheckout(dto, ctx);

      const outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
          VALUES (${scope}, ${idempotencyKey}, ${requestHash}, 'IN_PROGRESS', now() + interval '${Prisma.raw(String(IDEMPOTENCY_TTL_HOURS))} hours', now())
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING id
        `;

        if (claimed.length > 0) {
          const session = await this.performCheckoutTx(tx, dto, pricing, ctx);
          await tx.$executeRaw`
            UPDATE idempotency_keys
            SET status = 'COMPLETED', response_snapshot = ${JSON.stringify(session)}::jsonb, updated_at = now()
            WHERE scope = ${scope} AND key = ${idempotencyKey}
          `;
          return { kind: "created" as const, session };
        }

        // Lost the race — wait on the actual row lock (no polling):
        // this SELECT...FOR UPDATE blocks until the owning transaction
        // commits or rolls back.
        const existing = await tx.$queryRaw<
          { status: string; request_hash: string; response_snapshot: unknown }[]
        >`SELECT status, request_hash, response_snapshot FROM idempotency_keys WHERE scope = ${scope} AND key = ${idempotencyKey} FOR UPDATE`;

        if (existing.length === 0) {
          // The prior owner's ENTIRE transaction rolled back — its
          // idempotency_keys row vanished with it. Nothing is
          // reserved anymore; retry from scratch in a new transaction.
          return { kind: "retry" as const };
        }
        const row = existing[0];
        if (row.status !== "COMPLETED") {
          return { kind: "retry" as const };
        }
        if (row.request_hash !== requestHash) {
          throw new BusinessException(409, ERROR_CODES.CONFLICT, "Idempotency-Key was already used with a different request");
        }
        return { kind: "existing" as const, session: row.response_snapshot };
      });

      if (outcome.kind !== "retry") return outcome.session;
    }

    throw new BusinessException(
      409,
      ERROR_CODES.CONFLICT,
      "Could not complete checkout under concurrent load — please retry"
    );
  }

  /** Prices shipping for every requested allocation WITHOUT holding any row lock. */
  private async priceCheckout(dto: CreateCheckoutSessionDto, ctx: ActorContext) {
    const opportunity = await this.prisma.opportunity.findUniqueOrThrow({ where: { id: dto.opportunityId } });
    const tariff = await this.shippingTariff.getCurrentPolicy();

    const locations = await this.prisma.companyLocation.findMany({
      where: { id: { in: dto.allocations.map((a) => a.companyLocationId) } },
      include: { city: { include: { region: true } } },
    });
    const byId = new Map(locations.map((l) => [l.id, l]));

    const priced = dto.allocations.map((a) => {
      const loc = byId.get(a.companyLocationId);
      if (!loc || loc.companyId !== ctx.companyId) {
        throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "A fulfillment location does not belong to your company");
      }
      if (!loc.isActive) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "A fulfillment location is not active");
      }
      const tier = resolveShippingTier({
        branchCityId: loc.cityId,
        branchRegionId: loc.city.regionId,
        opportunityFulfillmentCityId: opportunity.fulfillmentCityId ?? "",
        opportunityFulfillmentRegionId: opportunity.fulfillmentRegionId ?? "",
      });
      const fee = feeForTier(
        {
          sameCityFeeAmount: tariff.sameCityFeeAmount,
          sameRegionDifferentCityFeeAmount: tariff.sameRegionDifferentCityFeeAmount,
          differentRegionFeeAmount: tariff.differentRegionFeeAmount,
        },
        tier
      );
      return { location: loc, quantity: a.quantity, tier, fee };
    });

    return { opportunity, tariff, priced };
  }

  private async performCheckoutTx(
    tx: Prisma.TransactionClient,
    dto: CreateCheckoutSessionDto,
    pricing: Awaited<ReturnType<CheckoutSessionService["priceCheckout"]>>,
    ctx: ActorContext
  ) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    if (company.accountType !== AccountType.TRADER) {
      throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "Only trader accounts can check out");
    }

    const mandatoryPolicies = await tx.policyVersion.findMany({
      where: { isPublished: true, isMandatory: true },
    });
    if (mandatoryPolicies.length > 0) {
      const accepted = await tx.policyAcceptance.findMany({
        where: { companyId: ctx.companyId, policyVersionId: { in: mandatoryPolicies.map((p) => p.id) } },
      });
      const acceptedIds = new Set(accepted.map((a) => a.policyVersionId));
      const missing = mandatoryPolicies.some((p) => !acceptedIds.has(p.id));
      if (missing) {
        throw new BusinessException(403, ERROR_CODES.POLICY_REACCEPTANCE_REQUIRED, "You must accept the latest platform policy first");
      }
    }

    const settings = await this.checkoutSettings.getConfig();
    const windowStart = new Date(Date.now() - settings.abuseWindowMinutes * 60_000);
    const qualifyingReleases = await tx.checkoutSession.findMany({
      where: {
        traderCompanyId: ctx.companyId,
        opportunityId: dto.opportunityId,
        releaseReason: { in: ["EXPIRED", "TRADER_ABANDONED"] },
        lockReleasedAt: { gte: windowStart },
      },
      select: { lockReleasedAt: true },
    });
    const cooldown = computeCheckoutCooldown(
      qualifyingReleases.map((r) => r.lockReleasedAt as Date),
      settings.abuseThresholdCount,
      settings.abuseWindowMinutes,
      settings.cooldownMinutes,
      new Date()
    );
    if (cooldown.blocked) {
      throw new BusinessException(429, ERROR_CODES.RATE_LIMITED, "Too many recent unpaid checkout attempts — please try again later");
    }

    // Lazy cleanup: release this trader's own expired lock on this
    // opportunity first, so it never blocks a legitimate new attempt.
    const lazyExpired = await tx.$queryRaw<{ id: string }[]>`
      UPDATE checkout_sessions
      SET status = 'EXPIRED', lock_released_at = now(), release_reason = 'EXPIRED'
      WHERE opportunity_id = ${dto.opportunityId}::uuid AND trader_company_id = ${ctx.companyId}::uuid
        AND status = 'LOCKED' AND lock_released_at IS NULL AND lock_expires_at <= now()
      RETURNING id
    `;
    for (const row of lazyExpired) {
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          action: "CHECKOUT_LOCK_EXPIRED",
          entityType: "checkout_session",
          entityId: row.id,
          requestId: ctx.requestId,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "CHECKOUT_LOCK_EXPIRED", payload: { checkoutSessionId: row.id } as Prisma.InputJsonValue },
      });
    }

    // Lock order: opportunity FIRST, branches SECOND — fixed for 7C too.
    const oppRows = await tx.$queryRaw<
      { id: string; status: string; target_quantity: number; funded_quantity: number; share_quantity: number | null; company_id: string }[]
    >`SELECT id, status, target_quantity, funded_quantity, share_quantity, company_id FROM opportunities WHERE id = ${dto.opportunityId}::uuid FOR UPDATE`;
    if (oppRows.length === 0) throw new NotFoundException("Opportunity not found");
    const opp = oppRows[0];
    if (opp.status !== "ACTIVE") {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "This opportunity is not currently accepting new checkouts");
    }
    if (opp.company_id === ctx.companyId) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "A supplier cannot purchase its own opportunity");
    }
    if (opp.share_quantity && dto.quantity % opp.share_quantity !== 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Quantity must be a whole multiple of the share size");
    }

    const activeLocksSum = await tx.$queryRaw<{ sum: number | null }[]>`
      SELECT COALESCE(SUM(locked_quantity), 0)::int AS sum FROM checkout_sessions
      WHERE opportunity_id = ${dto.opportunityId}::uuid AND lock_released_at IS NULL
        AND (
          (status = 'LOCKED' AND lock_expires_at > now())
          OR (status = 'PAYMENT_PENDING' AND payment_deadline_at > now())
        )
    `;
    const available = opp.target_quantity - opp.funded_quantity - (activeLocksSum[0].sum ?? 0);
    if (available < dto.quantity) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "The requested quantity is no longer available");
    }

    // Branches SECOND, FOR SHARE ORDER BY id — deterministic lock order.
    const locationIds = [...dto.allocations.map((a) => a.companyLocationId)].sort();
    const lockedLocations = await tx.$queryRaw<{ id: string; is_active: boolean; company_id: string }[]>`
      SELECT id, is_active, company_id FROM company_locations WHERE id = ANY(${locationIds}::uuid[]) ORDER BY id FOR SHARE
    `;
    const lockedById = new Map(lockedLocations.map((l) => [l.id, l]));
    for (const p of pricing.priced) {
      const fresh = lockedById.get(p.location.id);
      if (!fresh || fresh.company_id !== ctx.companyId || !fresh.is_active) {
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "A fulfillment location changed — please retry checkout");
      }
    }

    // Re-verify the shipping tariff version used at pricing time is
    // still current — read through the SAME tx, never a separate
    // connection, so this check sees exactly what this transaction sees.
    const currentTariffRow = await tx.shippingTariffPolicyVersion.findFirst({ orderBy: { version: "desc" } });
    if (!currentTariffRow || currentTariffRow.id !== pricing.tariff.id) {
      throw new BusinessException(409, ERROR_CODES.CONFLICT, "Shipping tariff changed — please retry checkout");
    }

    if (pricing.priced.reduce((s, p) => s + p.quantity, 0) !== dto.quantity) {
      // This is the FIRST line of defense — it prevents any write
      // from being attempted at all. The DEFERRABLE CONSTRAINT
      // TRIGGER on checkout_location_allocations (evaluated via the
      // explicit SET CONSTRAINTS ... IMMEDIATE call below, right
      // after the allocations are inserted) is the SECOND, genuinely
      // enforced line of defense at the DB level — proven directly to
      // reliably surface its error through this same transaction.
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Branch allocations must sum exactly to the requested quantity");
    }

    const fullOpportunity = await tx.opportunity.findUniqueOrThrow({ where: { id: dto.opportunityId } });
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + settings.lockDurationMinutes * 60_000);

    const productsSubtotalExclTax = Number(fullOpportunity.unitPriceExclTaxAmount) * dto.quantity;
    const productsTax = Number(fullOpportunity.unitTaxAmount) * dto.quantity;
    const productsSubtotalInclTax = Number(fullOpportunity.unitPriceAmount) * dto.quantity;
    const totalShipping = pricing.priced.reduce((s, p) => s + p.fee, 0);
    const grandTotal = productsSubtotalInclTax + totalShipping;

    const created = await tx.checkoutSession.create({
      data: {
        opportunityId: dto.opportunityId,
        traderCompanyId: ctx.companyId,
        lockedQuantity: dto.quantity,
        lockCreatedAt: now,
        lockExpiresAt,
        traderCompanySnapshot: { legalName: company.legalName, crNumber: company.crNumber },
      },
    });

    await tx.quoteSnapshot.create({
      data: {
        checkoutSessionId: created.id,
        productApprovalSnapshotId: fullOpportunity.productApprovalSnapshotId!,
        salesUnitNameAr: fullOpportunity.salesUnitNameAr!,
        salesUnitNameEn: fullOpportunity.salesUnitNameEn!,
        packageContentQuantity: fullOpportunity.packageContentQuantity,
        packageContentUnitNameAr: fullOpportunity.packageContentUnitNameAr,
        packageContentUnitNameEn: fullOpportunity.packageContentUnitNameEn,
        quantity: dto.quantity,
        shareQuantity: fullOpportunity.shareQuantity ?? 1,
        sharePercentageReadable: fullOpportunity.shareBasisPoints ? fullOpportunity.shareBasisPoints / 100 : 0,
        unitPriceInclTaxAmount: fullOpportunity.unitPriceAmount,
        unitPriceExclTaxAmount: fullOpportunity.unitPriceExclTaxAmount!,
        unitTaxAmount: fullOpportunity.unitTaxAmount!,
        taxRatePercent: fullOpportunity.taxRatePercent!,
        taxCalculationRuleCode: fullOpportunity.taxCalculationRuleCode!,
        taxCalculationRuleVersion: fullOpportunity.taxCalculationRuleVersion!,
        productsSubtotalExclTaxAmount: productsSubtotalExclTax,
        productsTaxAmount: productsTax,
        productsSubtotalInclTaxAmount: productsSubtotalInclTax,
        totalShippingFeeAmount: totalShipping,
        grandTotalAmount: grandTotal,
        shippingTariffPolicyVersionId: pricing.tariff.id,
        shippingProviderCode: pricing.tariff.providerCode,
      },
    });

    for (const p of pricing.priced) {
      const loc = p.location;
      await tx.checkoutLocationAllocation.create({
        data: {
          checkoutSessionId: created.id,
          companyLocationId: loc.id,
          locationNameSnapshot: loc.name,
          cityNameArSnapshot: loc.city.nameAr,
          cityNameEnSnapshot: loc.city.nameEn,
          regionNameArSnapshot: loc.city.region.nameAr,
          regionNameEnSnapshot: loc.city.region.nameEn,
          addressSnapshot: loc.shortAddress,
          latitudeSnapshot: loc.latitude,
          longitudeSnapshot: loc.longitude,
          contactNameSnapshot: loc.contactName,
          contactPhoneSnapshot: loc.contactPhone,
          quantity: p.quantity,
          shippingTierCode: p.tier,
          shippingFeeAmount: p.fee,
        },
      });
    }

    // Forces Postgres to evaluate the DEFERRABLE INITIALLY DEFERRED
    // trigger on checkout_location_allocations NOW, inside this
    // transaction, instead of silently at COMMIT. Proven directly:
    // without this, Prisma logs "transaction failed to commit"
    // internally yet still resolves $transaction()'s Promise as a
    // success — a genuine Prisma gap in surfacing deferred-trigger
    // errors. This makes the trigger a real, enforced second line of
    // defense (the application-level sum check above remains the
    // first and primary one).
    await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_checkout_allocation_totals IMMEDIATE`);

    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.USER,
        actorId: ctx.userId,
        companyId: ctx.companyId,
        action: "CHECKOUT_LOCK_CREATED",
        entityType: "checkout_session",
        entityId: created.id,
        afterData: { opportunityId: dto.opportunityId, quantity: dto.quantity } as Prisma.InputJsonValue,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    await tx.outboxEvent.create({
      data: { eventType: "CHECKOUT_LOCK_CREATED", payload: { checkoutSessionId: created.id } as Prisma.InputJsonValue },
    });

    return toTraderCheckoutView(created, {
      quantity: dto.quantity,
      shareQuantity: fullOpportunity.shareQuantity ?? 1,
      sharePercentageReadable: fullOpportunity.shareBasisPoints ? fullOpportunity.shareBasisPoints / 100 : 0,
      productsSubtotalInclTaxAmount: productsSubtotalInclTax,
      totalShippingFeeAmount: totalShipping,
      grandTotalAmount: grandTotal,
      currency: "SAR",
      allocations: pricing.priced.map((p) => ({
        companyLocationId: p.location.id,
        locationName: p.location.name,
        quantity: p.quantity,
        shippingFeeAmount: p.fee,
      })),
    });
  }

  async getById(id: string, ctx: ActorContext) {
    await this.lazyExpire(id);
    const session = await this.prisma.checkoutSession.findFirst({
      where: { id, traderCompanyId: ctx.companyId },
      include: { quoteSnapshot: true, allocations: true },
    });
    if (!session) throw new NotFoundException("Checkout session not found");
    return session;
  }

  async abandon(id: string, ctx: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE checkout_sessions
        SET status = 'ABANDONED', lock_released_at = now(), release_reason = 'TRADER_ABANDONED'
        WHERE id = ${id}::uuid AND trader_company_id = ${ctx.companyId}::uuid AND lock_released_at IS NULL
        RETURNING id
      `;
      if (claimed.length === 0) {
        const exists = await tx.checkoutSession.findFirst({ where: { id, traderCompanyId: ctx.companyId } });
        if (!exists) throw new NotFoundException("Checkout session not found");
        throw new BusinessException(409, ERROR_CODES.CONFLICT, "This checkout session is no longer active");
      }

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action: "CHECKOUT_LOCK_ABANDONED",
          entityType: "checkout_session",
          entityId: id,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "CHECKOUT_LOCK_ABANDONED", payload: { checkoutSessionId: id } as Prisma.InputJsonValue },
      });

      return tx.checkoutSession.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Lazy cleanup at read time — only writes (and only audits/emits an
   * event) when the atomic claim actually matches a row still LOCKED
   * past its expiry. A session already EXPIRED/ABANDONED matches
   * nothing here, so a repeated GET never re-emits the event.
   */
  private async lazyExpire(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE checkout_sessions
        SET status = 'EXPIRED', lock_released_at = now(), release_reason = 'EXPIRED'
        WHERE id = ${id}::uuid AND status = 'LOCKED' AND lock_released_at IS NULL AND lock_expires_at <= now()
        RETURNING id
      `;
      if (claimed.length === 0) return;

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          action: "CHECKOUT_LOCK_EXPIRED",
          entityType: "checkout_session",
          entityId: id,
          requestId: "lazy-cleanup",
        },
      });
      await tx.outboxEvent.create({
        data: { eventType: "CHECKOUT_LOCK_EXPIRED", payload: { checkoutSessionId: id } as Prisma.InputJsonValue },
      });
    });
  }
}

function canonicalize(dto: CreateCheckoutSessionDto): unknown {
  return {
    opportunityId: dto.opportunityId,
    quantity: dto.quantity,
    allocations: [...dto.allocations]
      .sort((a, b) => a.companyLocationId.localeCompare(b.companyLocationId))
      .map((a) => ({ companyLocationId: a.companyLocationId, quantity: a.quantity })),
  };
}

/** Never exposes shareBasisPoints, any *PolicyVersionId, or productApprovalSnapshotId. */
function toTraderCheckoutView(
  session: { id: string; status: string; lockExpiresAt: Date },
  quote: {
    quantity: number;
    shareQuantity: number;
    sharePercentageReadable: number;
    productsSubtotalInclTaxAmount: number;
    totalShippingFeeAmount: number;
    grandTotalAmount: number;
    currency: string;
    allocations: { companyLocationId: string; locationName: string; quantity: number; shippingFeeAmount: number }[];
  }
) {
  return {
    id: session.id,
    status: session.status,
    lockExpiresAt: session.lockExpiresAt,
    quantity: quote.quantity,
    minimumQuantity: quote.shareQuantity,
    sharePercentage: quote.sharePercentageReadable,
    productsSubtotalInclTaxAmount: quote.productsSubtotalInclTaxAmount,
    totalShippingFeeAmount: quote.totalShippingFeeAmount,
    grandTotalAmount: quote.grandTotalAmount,
    currency: quote.currency,
    allocations: quote.allocations,
  };
}
