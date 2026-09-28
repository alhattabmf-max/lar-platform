import { Injectable } from "@nestjs/common";
import { AuditActorType, OpportunityStatus, ProductApprovalStatus } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ProductsService } from "../products/products.service";
import { ProductMediaService } from "../products/product-media.service";
import { OpportunitiesService } from "../opportunities/opportunities.service";
import { AuditService } from "../audit/audit.service";
import { assertNoBuyerCommitted, deleteOffersTx } from "../common/removal";
import {
  OPPORTUNITY_REASON_CODES,
  OPPORTUNITY_REASON_DETAILS,
  type OpportunityReasonCode,
} from "@platform/domain";
import type { CreateListingDto } from "./dto/create-listing.dto";

/**
 * A reason code, recognised as one.
 *
 * The row's column is a plain string and the thrown sentence is prose,
 * so both are checked against the closed vocabulary before either is
 * trusted. An unrecognised value leaves the caller with no reason at
 * all, which is the honest outcome — a guessed one would be shown to a
 * supplier as fact.
 */
function isOpportunityReasonCode(value: string): value is OpportunityReasonCode {
  return Object.prototype.hasOwnProperty.call(OPPORTUNITY_REASON_CODES, value);
}

/**
 * Matches the sentence `handlePublishBlocked` threw back to its code.
 *
 * The blocker's details ARE the message on that path — there is no
 * other carrier — so this is the only way to recover which rule fired
 * without changing the method every other route depends on.
 */
function reasonCodeFromDetails(message: string): OpportunityReasonCode | null {
  for (const [code, details] of Object.entries(OPPORTUNITY_REASON_DETAILS)) {
    if (details === message) return code as OpportunityReasonCode;
  }
  return null;
}

/**
 * A PROVISIONAL window, opening now and running for so many days.
 *
 * The supplier answers a duration; the database stores two instants.
 * What matters about this pair is its LENGTH — publication re-anchors
 * it to the moment the offer actually becomes buyable, reading the
 * duration back out of the distance between these two. So a row created
 * today and published in a fortnight still runs its full period.
 *
 * The recovery half of that conversion lives with the publication, in
 * `OpportunitiesService.publish`, because that is the only place it may
 * be applied: a window stamped before a publication that then failed
 * would start a clock on an offer nobody could buy.
 */
function windowFromNow(days: number): { startAt: Date; endAt: Date } {
  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + days * 86_400_000);
  return { startAt, endAt };
}

/** Declared locally, exactly as every other service in this codebase does. */
interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * A LISTING IS WHAT THE SUPPLIER CALLS A PRODUCT.
 *
 * The platform stores it as two rows and always will: a catalogue row
 * whose identity is frozen into an append-only snapshot the moment it
 * goes live, and an offer row carrying the pinned tax, share-tier,
 * commission and price that every order hangs off. Those two exist so
 * that a supplier can fix a typo tomorrow without rewriting what
 * somebody bought last month — the owner's own requirement, and the
 * only mechanism that delivers it.
 *
 * WHAT CHANGES HERE IS THE SEAM, NOT THE MODEL. The word "opportunity"
 * leaves the supplier's vocabulary entirely: one form, one button, one
 * thing in the list. This class is the only place that knows there were
 * ever two.
 *
 * IT ORCHESTRATES; IT DOES NOT REIMPLEMENT. Every step below is an
 * existing, tested method — technical checks, auto-approval, snapshot
 * building, eligibility, and the whole of publish()'s economic pinning.
 * Not one line of money logic is copied here, because a second copy is
 * a second answer.
 */
@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly media: ProductMediaService,
    private readonly opportunities: OpportunitiesService,
    private readonly audit: AuditService
  ) {}

  /**
   * One call: the catalogue row, its image, auto-approval, the offer
   * row, and publication.
   *
   * NOT ONE TRANSACTION, and deliberately. Auto-approval writes a
   * snapshot the DB refuses to update or delete afterwards, image
   * processing is heavy and reaches storage outside the database, and
   * publish() resolves live policy versions. Each of those already
   * owns its own transaction and its own audit entry; wrapping them in
   * an outer one would either hold a connection through image encoding
   * or silently drop the audit trail of the steps that succeeded.
   *
   * WHAT HAPPENS WHEN A LATER STEP FAILS is therefore the important
   * part, and it is not an accident: the pair persists. A supplier
   * whose company has no tax profile yet does not lose a filled-in
   * form — `finishOrExplain` records the blocker on the row so the
   * listing appears in «يحتاج إجراء» with its reason, and `resume()`
   * finishes it once that reason is gone.
   */
  async create(dto: CreateListingDto, image: Buffer, ctx: ActorContext) {
    const window = windowFromNow(dto.offerDurationDays);

    const product = await this.products.create(
      {
        taxonomyNodeId: dto.taxonomyNodeId,
        salesUnitId: dto.salesUnitId,
        salesUnitNameAr: dto.salesUnitNameAr,
        salesUnitNameEn: dto.salesUnitNameEn,
        packageContentQuantity: dto.packageContentQuantity,
        packageContentUnitNameAr: dto.packageContentUnitNameAr,
        packageContentUnitNameEn: dto.packageContentUnitNameEn,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        descriptionAr: dto.descriptionAr,
        descriptionEn: dto.descriptionEn,
        weightPerUnit: dto.weightPerUnit,
        lengthCm: dto.lengthCm,
        widthCm: dto.widthCm,
        heightCm: dto.heightCm,
      },
      ctx
    );

    // BEFORE THE OFFER, because auto-approval refuses a product with no
    // main image and the offer is worth nothing unpublished.
    await this.media.upload(product.id, image, ctx);

    const opportunity = await this.opportunities.create(
      {
        productId: product.id,
        fulfillmentLocationId: dto.fulfillmentLocationId,
        targetQuantity: dto.targetQuantity,
        unitPriceAmount: dto.unitPriceAmount,
        // A PROVISIONAL WINDOW, replaced at publication.
        //
        // The columns are two real timestamps and stay that way — every
        // sweep, every order deadline and the whole lifecycle hang off
        // them. What the supplier answered is a DURATION, so one is
        // stamped from now and the other from now plus the days. If
        // publication is blocked and finished a week later, `publish()`
        // re-stamps both, and the countdown a buyer sees starts when
        // the thing actually became buyable.
        startAt: window.startAt.toISOString(),
        endAt: window.endAt.toISOString(),
        expectedPreparationDays: dto.expectedPreparationDays,
        // The one description the supplier wrote reaches both rows: the
        // catalogue keeps it as what the item IS, the offer as what is
        // shown on the page a buyer opens. One field, because a
        // supplier asked to write the same paragraph twice writes it
        // once and leaves the other empty.
        descriptionAr: dto.descriptionAr,
        descriptionEn: dto.descriptionEn,
      },
      ctx
    );

    return this.finishOrExplain(product.id, opportunity.id, ctx);
  }

  /**
   * Publish, and when the platform refuses, SAY WHY AND KEEP THE WORK.
   *
   * `handlePublishBlocked` throws `VALIDATION_FAILED` carrying an
   * English sentence, and on a FIRST publish — unlike a republish — it
   * writes nothing to the row. That is correct for the endpoint it was
   * written for, and wrong here: a supplier who filled in a long form
   * saw "VALIDATION_FAILED" and had no idea their company was missing a
   * tax profile, while the product they had just typed sat as a DRAFT
   * they were never told about. Pressing the button again made a second
   * one.
   *
   * ADDING A PRODUCT IS NOT SELLING IT, and only the second one is
   * gated. The owner's rule: «لا تجعل قيود بيانات المورد تغلق اظافة
   * المنتج اجعلها فقط على عرض المنتج للبيع». A supplier missing a tax
   * profile can build their catalogue today and offer it the moment
   * their record is complete — so this RESOLVES rather than throws,
   * and reports which of the two happened.
   *
   * The gate itself is untouched. Publishing without a verified bank
   * account or a tax profile stays impossible; what changed is that
   * being unable to SELL no longer means being unable to ADD.
   */
  private async finishOrExplain(
    productId: string,
    opportunityId: string,
    ctx: ActorContext
  ): Promise<{ id: string; listed: boolean; blockedReason: OpportunityReasonCode | null }> {
    try {
      const published = await this.finish(productId, opportunityId, ctx);
      return { id: published.id, listed: true, blockedReason: null };
    } catch (error) {
      const blocker = await this.recordBlocker(opportunityId, error);
      // NOT a publication blocker — a bad image, a lost connection, a
      // bug. Those are real failures and must not be dressed as a saved
      // product.
      if (!blocker) throw error;

      return { id: opportunityId, listed: false, blockedReason: blocker };
    }
  }

  /**
   * Writes the blocker onto the row and returns its code.
   *
   * Returns null for anything that is not a recognised publication
   * blocker — a technical-check failure, a bug, a lost connection —
   * because guessing a reason is worse than showing none.
   */
  private async recordBlocker(
    opportunityId: string,
    error: unknown
  ): Promise<OpportunityReasonCode | null> {
    if (!(error instanceof BusinessException)) return null;

    const row = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { reasonCode: true },
    });

    // `handlePublishBlocked` already wrote it on a republish path. On a
    // first publish it wrote nothing, and the sentence it threw is the
    // only place the reason exists — so it is matched back to its code.
    const fromRow = row?.reasonCode;
    const code =
      (fromRow && isOpportunityReasonCode(fromRow) ? fromRow : null) ??
      reasonCodeFromDetails(error.message);

    if (!code) return null;

    if (!fromRow) {
      await this.prisma.opportunity.update({
        where: { id: opportunityId },
        data: {
          reasonCode: code,
          reasonDetails: OPPORTUNITY_REASON_DETAILS[code],
          blockedAt: new Date(),
        },
      });
    }

    return code;
  }

  /**
   * Finishes a pair: auto-approve, then publish.
   *
   * Separate from create() because it is also how a blocked listing
   * resumes — same two steps, same order, no second implementation.
   */
  private async finish(productId: string, opportunityId: string, ctx: ActorContext) {
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });

    // THE WINDOW IS NO LONGER STAMPED HERE. It used to be, and the
    // stamp landed BEFORE publication — so a publication that was then
    // refused had already started the clock on an offer nobody could
    // buy, and the days the supplier chose drained while they fixed
    // whatever blocked it.
    //
    // `OpportunitiesService.publish` now stamps it inside the same
    // transaction that flips the status, from the same duration carried
    // as the distance between the pair written at creation. Every
    // publication path goes through that one method, so the rule holds
    // for the direct route as well — which this one never covered.

    // APPROVED already means this is a resume, not a first publish; the
    // snapshot exists and re-submitting would be refused anyway.
    if (
      product.approvalStatus === ProductApprovalStatus.DRAFT ||
      product.approvalStatus === ProductApprovalStatus.REJECTED
    ) {
      await this.products.submit(productId, ctx);
    }

    return this.opportunities.publish(opportunityId, ctx);
  }

  /**
   * The supplier fixed whatever blocked publication. Try again.
   *
   * Reached from the listing's own row rather than from anything
   * calling itself an opportunity.
   */
  async resume(opportunityId: string, ctx: ActorContext) {
    const listing = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, companyId: ctx.companyId },
      select: { id: true, productId: true, status: true },
    });
    if (!listing) {
      throw new BusinessException(404, ERROR_CODES.NOT_FOUND, "Listing not found");
    }
    if (
      listing.status !== OpportunityStatus.DRAFT &&
      listing.status !== OpportunityStatus.ACTION_REQUIRED
    ) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Cannot publish a listing with status ${listing.status}`
      );
    }

    // THROWS when it is still blocked, unlike `create`. The supplier
    // pressed «نشر» here — telling them it worked when it did not would
    // be the lie that button exists to avoid.
    return this.finish(listing.productId, listing.id, ctx);
  }

  /**
   * REMOVING A LISTING REMOVES THE LISTING — «احذف العرض أو عدّله دام
   * ما عليه أي عملية».
   *
   * IT USED TO REMOVE THE PRODUCT TOO, and that is the defect this
   * replaces. The old rule deleted both rows when the product carried
   * no approval snapshot and ARCHIVED the product when it did — and
   * since a snapshot is written the moment a product is APPROVED, not
   * when it is published, every real product carried one. So deleting
   * a draft offer nobody had ever seen archived a perfectly good
   * product, and archiving is a one-way door: no edit, no offer, no
   * unarchive. The owner deleted two drafts and lost two products.
   *
   * THE PRODUCT IS NOT TOUCHED HERE AT ALL. It is a record of its
   * own, it outlives any one offer, and it has its own delete now —
   * `DELETE companies/me/products/:id`, under the same rule.
   *
   * AND THE RULE IS THE ONE RULE: `assertNoBuyerCommitted` refuses while a
   * buyer holds a live basket (temporarily — the lock expires) and
   * once a buyer has paid (permanently). An abandoned basket is
   * neither, and its rows go with the offer they were opened on.
   */
  async remove(opportunityId: string, ctx: ActorContext) {
    const listing = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, companyId: ctx.companyId },
      select: { id: true, productId: true, status: true },
    });
    if (!listing) {
      throw new BusinessException(404, ERROR_CODES.NOT_FOUND, "Listing not found");
    }

    await this.prisma.$transaction(async (tx) => {
      await assertNoBuyerCommitted(tx, [listing.id]);

      await this.audit.log(
        {
          actorType: AuditActorType.USER,
          actorId: ctx.userId,
          companyId: ctx.companyId,
          action: "LISTING_DELETED",
          entityType: "opportunity",
          entityId: listing.id,
          before: { productId: listing.productId, status: listing.status },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx
      );

      await deleteOffersTx(tx, [listing.id]);
    });

    return { removed: "DELETED" as const };
  }
}
