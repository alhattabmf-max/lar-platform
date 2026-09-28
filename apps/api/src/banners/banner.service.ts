import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AuditActorType,
  Prisma,
  type BannerPlacement,
  type BannerImageLocale as PrismaBannerImageLocale,
} from "@prisma/client";
import {
  ERROR_CODES,
  BANNER_IMAGE_LOCALES,
  type BannerImageLocale,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BannerPolicyService } from "../settings/banner-policy.service";
import { BannerImageService } from "./banner-image.service";
import { BusinessException } from "../common/errors/business-exception";
import {
  LIVE_BANNER_CONDITION_B,
  SELECT_DB_NOW,
  placementLock,
} from "./banner-visibility.sql";
import {
  checkOverlap,
  deriveBannerState,
  type BannerWindow,
} from "./banner-window.util";

/**
 * Banner scheduling and visibility.
 *
 * Two responsibilities, deliberately kept in one place:
 *
 *   1. THE definition of "publicly visible" — every public path reads
 *      through this service, never with its own copy of the predicate.
 *   2. Serialised enforcement of the concurrent-live limit.
 *
 * Storage and HTTP concerns live elsewhere: this service never touches
 * an object key and never builds a URL.
 */

export interface BannerActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Every column a public consumer may see. No object keys, no schedule, no actor. */
interface PublicBannerRow {
  id: string;
  link_url: string | null;
}

/** What the image route needs, and nothing else. */
export interface LiveBannerImageRow {
  id: string;
  imageObjectKey: string;
  imageThumbnailKey: string;
  imageContentType: string;
  imageETag: string;
  imageThumbnailETag: string;
  imageUpdatedAt: Date;
}

/**
 * What a visitor receives: an id, a destination, and nothing else.
 *
 * No title and no body, because a banner has none — every word is drawn
 * inside the artwork. The image route is built by the caller from the
 * id and the locale it asked for.
 */
export interface PublicBanner {
  id: string;
  linkUrl: string | null;
}

/**
 * Prisma reports an enum by its MEMBER NAME, not by the value stored in
 * PostgreSQL: the column holds "ar-SA" while the client hands back
 * "AR_SA". A hyphen cannot appear in a Prisma enum member, so the two
 * spellings are unavoidable — and converting in exactly these two
 * functions is what keeps that fact from leaking into every caller.
 */
const LOCALE_CODE_BY_MEMBER: Record<
  PrismaBannerImageLocale,
  BannerImageLocale
> = {
  AR_SA: "ar-SA",
  EN_SA: "en-SA",
};

const LOCALE_MEMBER_BY_CODE: Record<
  BannerImageLocale,
  PrismaBannerImageLocale
> = {
  "ar-SA": "AR_SA",
  "en-SA": "EN_SA",
};

function toLocaleCode(member: PrismaBannerImageLocale): BannerImageLocale {
  return LOCALE_CODE_BY_MEMBER[member];
}

export function toLocaleMember(
  code: BannerImageLocale,
): PrismaBannerImageLocale {
  return LOCALE_MEMBER_BY_CODE[code];
}

@Injectable()
export class BannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: BannerPolicyService,
    // Only for discarding the stored objects of a DELETED banner, after
    // its transaction commits. No cycle: the image service knows
    // nothing about this one.
    private readonly images: BannerImageService,
  ) {}

  // ----- public visibility -------------------------------------------------

  /**
   * Banners live RIGHT NOW in one placement, in display order.
   *
   * A single statement, so PostgreSQL's `now()` is the one transaction
   * timestamp for the whole predicate. `placement` and nothing else is
   * bound as a parameter — the condition itself is a fixed fragment.
   */
  async listLive(
    placement: BannerPlacement,
    locale: BannerImageLocale,
  ): Promise<PublicBanner[]> {
    // JOIN, not LEFT JOIN. A banner without artwork for THIS language is
    // not returned at all — there is no fallback to the other language,
    // and no empty frame. Activation already refuses a banner missing
    // either image, so this is a second line rather than the only one.
    const rows = await this.prisma.$queryRaw<PublicBannerRow[]>(Prisma.sql`
      SELECT b.id, b.link_url
      FROM promotional_banners b
      JOIN banner_images i
        ON i.banner_id = b.id
       AND i.locale = ${locale}::"banner_image_locale"
      WHERE b.placement = ${placement}::"BannerPlacement"
        AND ${LIVE_BANNER_CONDITION_B}
      ORDER BY b.sort_order ASC, b.created_at ASC
    `);

    return rows.map((row) => ({ id: row.id, linkUrl: row.link_url }));
  }

  /**
   * Image metadata for a banner that is live RIGHT NOW.
   *
   * Composes the SAME `LIVE_BANNER_CONDITION` the list uses. That is the
   * point: an image can never be fetchable for a banner the list will
   * not show, so a draft, a scheduled banner, or an expired one cannot
   * be discovered by probing image URLs.
   *
   * Returns null both when the banner is not live and when it has no
   * image, so the caller renders one indistinguishable 404 for both.
   */
  async findLiveImage(
    id: string,
    locale: BannerImageLocale,
  ): Promise<LiveBannerImageRow | null> {
    // The artwork row's columns are all NOT NULL, so there is nothing to
    // re-check here: either the join found a complete image for this
    // language or it found nothing. The old shape needed six null checks
    // to prove the same thing.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        object_key: string;
        thumbnail_key: string;
        content_type: string;
        etag: string;
        thumbnail_etag: string;
        updated_at: Date;
      }>
    >(Prisma.sql`
      SELECT b.id, i.object_key, i.thumbnail_key, i.content_type,
             i.etag, i.thumbnail_etag, i.updated_at
      FROM promotional_banners b
      JOIN banner_images i
        ON i.banner_id = b.id
       AND i.locale = ${locale}::"banner_image_locale"
      WHERE b.id = ${id}::uuid
        AND ${LIVE_BANNER_CONDITION_B}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      imageObjectKey: row.object_key,
      imageThumbnailKey: row.thumbnail_key,
      imageContentType: row.content_type,
      imageETag: row.etag,
      imageThumbnailETag: row.thumbnail_etag,
      imageUpdatedAt: row.updated_at,
    };
  }

  // ----- admin reads -------------------------------------------------------

  /**
   * Every banner in a placement, in display order, with its derived
   * state. Object keys and ETags are deliberately not selected — an
   * admin sees WHETHER there is an image, never where it lives.
   */
  async listForAdmin(placement: BannerPlacement) {
    const [rows, [{ now }]] = await Promise.all([
      this.prisma.promotionalBanner.findMany({
        where: { placement },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          placement: true,
          linkUrl: true,
          sortOrder: true,
          isActive: true,
          startsAt: true,
          endsAt: true,
          createdAt: true,
          updatedAt: true,
          // WHICH LANGUAGES have artwork, and nothing about where it
          // lives. An admin needs to know what is still missing; object
          // keys are storage addresses and stay server-side.
          images: { select: { locale: true } },
        },
      }),
      this.prisma.$queryRaw<Array<{ now: Date }>>(SELECT_DB_NOW),
    ]);

    return rows.map(({ images, ...row }) => ({
      ...row,
      images: images.map((image) => toLocaleCode(image.locale)),
      state: deriveBannerState(row, now),
    }));
  }

  // ----- serialised mutation ----------------------------------------------

  /**
   * Runs `fn` with the placement locked and the database clock pinned.
   *
   * Order matters and is enforced here rather than left to callers:
   * the advisory lock is taken FIRST, before any window is read and
   * before the clock is sampled, so two concurrent activations cannot
   * both observe a pre-change world. `now` is read once from the
   * database inside the same transaction and reused for the entire
   * overlap computation, so every interval comparison is against one
   * instant.
   *
   * The lock is transaction-scoped: it releases on COMMIT and on
   * ROLLBACK alike, so no failure path can leak it.
   */
  private async withPlacementLock<T>(
    placement: BannerPlacement,
    fn: (tx: Prisma.TransactionClient, now: Date) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // $executeRaw, NOT $queryRaw. `pg_advisory_xact_lock()` returns SQL
      // `void`, and $queryRaw deserializes every returned column — Prisma
      // has no mapping for `void`, so it threw "Failed to deserialize
      // column of type 'void'" and every banner create, activate and
      // schedule answered 500. $executeRaw returns only a row count and
      // never inspects the columns, which is exactly what taking a lock
      // needs. The line below is $queryRaw on purpose: it really does
      // select a value.
      await tx.$executeRaw(placementLock(placement));
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>(SELECT_DB_NOW);
      return fn(tx, now);
    });
  }

  /**
   * Refuses a change that would put more than the configured number of
   * banners live at the same instant, at any point from `now` onward.
   *
   * Must be called with the placement lock already held.
   */
  private async assertWithinConcurrentLimit(
    tx: Prisma.TransactionClient,
    placement: BannerPlacement,
    proposed: BannerWindow,
    now: Date,
    excludeId?: string,
  ): Promise<void> {
    const { maxConcurrentLiveBannersPerPlacement } =
      await this.policy.getPolicy();

    const others = await tx.promotionalBanner.findMany({
      where: {
        placement,
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, startsAt: true, endsAt: true },
    });

    const result = checkOverlap({
      others,
      proposed,
      now,
      maxConcurrent: maxConcurrentLiveBannersPerPlacement,
    });

    if (!result.allowed) {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        `This schedule would put ${result.peak} banners live at once in this placement, exceeding the limit of ${result.maxConcurrent}`,
      );
    }
  }

  /**
   * Activates or deactivates a banner.
   *
   * Only activation is checked: deactivating can never increase overlap.
   */
  /**
   * Refuses a banner that does not yet have artwork for every language.
   *
   * Reads inside the caller's transaction, under the placement lock, so
   * an image being deleted at the same instant cannot slip past.
   */
  private async assertEveryImagePresent(
    tx: Prisma.TransactionClient,
    bannerId: string,
  ): Promise<void> {
    const rows = await tx.bannerImage.findMany({
      where: { bannerId },
      select: { locale: true },
    });
    const present = new Set(rows.map((row) => toLocaleCode(row.locale)));
    const missing = BANNER_IMAGE_LOCALES.filter(
      (locale) => !present.has(locale),
    );

    if (missing.length > 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Cannot activate a banner without artwork for every language. Missing: ${missing.join(", ")}`,
      );
    }
  }

  async setActive(id: string, isActive: boolean, ctx: BannerActorContext) {
    const existing = await this.prisma.promotionalBanner.findUnique({
      where: { id },
      select: { placement: true },
    });
    if (!existing) throw new NotFoundException("Banner not found");

    return this.withPlacementLock(existing.placement, async (tx, now) => {
      const current = await tx.promotionalBanner.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Banner not found");

      if (isActive) {
        // BOTH LANGUAGES OR NOTHING. A banner is artwork, and going live
        // with one language missing would mean either showing a reader
        // the wrong language's picture or showing them an empty frame.
        // Neither is a state an operator chose, so it is refused here
        // rather than absorbed downstream.
        await this.assertEveryImagePresent(tx, id);

        await this.assertWithinConcurrentLimit(
          tx,
          current.placement,
          { id, startsAt: current.startsAt, endsAt: current.endsAt },
          now,
          id,
        );
      }

      const updated = await tx.promotionalBanner.update({
        where: { id },
        data: { isActive },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: isActive ? "BANNER_ACTIVATED" : "BANNER_DEACTIVATED",
          entityType: "promotional_banner",
          entityId: id,
          before: { isActive: current.isActive },
          after: { isActive },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { ...updated, state: deriveBannerState(updated, now) };
    });
  }

  /**
   * Changes the schedule window.
   *
   * Checked whenever the banner is active — moving a window is just as
   * capable of creating a future breach as activating one, so it goes
   * through the identical path rather than a lighter one.
   */
  async setSchedule(
    id: string,
    window: { startsAt: Date | null; endsAt: Date | null },
    ctx: BannerActorContext,
  ) {
    const existing = await this.prisma.promotionalBanner.findUnique({
      where: { id },
      select: { placement: true },
    });
    if (!existing) throw new NotFoundException("Banner not found");

    if (window.startsAt && window.endsAt && window.endsAt <= window.startsAt) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "endsAt must be after startsAt — the window is half-open and endsAt is exclusive",
      );
    }

    return this.withPlacementLock(existing.placement, async (tx, now) => {
      const current = await tx.promotionalBanner.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Banner not found");

      if (current.isActive) {
        await this.assertWithinConcurrentLimit(
          tx,
          current.placement,
          { id, startsAt: window.startsAt, endsAt: window.endsAt },
          now,
          id,
        );
      }

      const updated = await tx.promotionalBanner.update({
        where: { id },
        data: { startsAt: window.startsAt, endsAt: window.endsAt },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "BANNER_SCHEDULE_CHANGED",
          entityType: "promotional_banner",
          entityId: id,
          before: { startsAt: current.startsAt, endsAt: current.endsAt },
          after: { startsAt: window.startsAt, endsAt: window.endsAt },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { ...updated, state: deriveBannerState(updated, now) };
    });
  }

  /**
   * Updates text, link and sort order.
   *
   * `placement` is absent by construction — it is immutable after
   * creation. Nothing here can change visibility timing, so no lock and
   * no overlap check are needed.
   */
  async updateContent(
    id: string,
    data: {
      linkUrl?: string | null;
      sortOrder?: number;
    },
    ctx: BannerActorContext,
  ) {
    const current = await this.prisma.promotionalBanner.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException("Banner not found");

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.promotionalBanner.update({
        where: { id },
        data,
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "BANNER_UPDATED",
          entityType: "promotional_banner",
          entityId: id,
          before: {
            linkUrl: current.linkUrl,
            sortOrder: current.sortOrder,
          },
          after: {
            linkUrl: updated.linkUrl,
            sortOrder: updated.sortOrder,
          },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Rewrites display order for one placement.
   *
   * The caller must supply EXACTLY the placement's current banner ids —
   * no more, no fewer, no duplicates. A partial list is refused rather
   * than applied, because silently reordering a subset would leave the
   * remaining banners holding stale positions that collide with the new
   * ones, and the resulting order would depend on the createdAt
   * tiebreaker rather than on what the admin asked for.
   *
   * The whole rewrite runs in one transaction so a failure part-way
   * cannot leave two banners sharing a position.
   */
  async reorder(
    placement: BannerPlacement,
    orderedIds: string[],
    ctx: BannerActorContext,
  ) {
    const duplicates = orderedIds.filter(
      (id, i) => orderedIds.indexOf(id) !== i,
    );
    if (duplicates.length > 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "reorder must not contain duplicate banner ids",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.promotionalBanner.findMany({
        where: { placement },
        select: { id: true },
      });

      const existingIds = new Set(existing.map((b) => b.id));
      const sameSet =
        orderedIds.length === existing.length &&
        orderedIds.every((id) => existingIds.has(id));

      if (!sameSet) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "reorder must include exactly the placement's current banner ids",
        );
      }

      for (const [index, id] of orderedIds.entries()) {
        await tx.promotionalBanner.update({
          where: { id },
          data: { sortOrder: index },
        });
      }

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "BANNER_REORDERED",
          entityType: "promotional_banner",
          entityId: placement,
          after: { orderedIds },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { placement, orderedIds };
    });
  }

  /**
   * Creates a banner.
   *
   * `placement` is set here and is IMMUTABLE afterwards. Allowing it to
   * change would mean a single operation had to hold locks on two
   * placements at once, which is a deadlock waiting to happen the
   * moment two admins move banners in opposite directions. Since
   * banners are never deleted anyway, moving one means deactivating it
   * and creating another — no capability is lost.
   *
   * A banner is created inactive by default, so the common case takes
   * no lock at all. Creating one already active goes through the same
   * limit check as any other activation.
   */
  async create(
    input: {
      placement: BannerPlacement;
      linkUrl: string | null;
      sortOrder: number;
      isActive: boolean;
      startsAt: Date | null;
      endsAt: Date | null;
    },
    ctx: BannerActorContext,
  ) {
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "endsAt must be after startsAt — the window is half-open and endsAt is exclusive",
      );
    }

    return this.withPlacementLock(input.placement, async (tx, now) => {
      if (input.isActive) {
        await this.assertWithinConcurrentLimit(
          tx,
          input.placement,
          { id: "new", startsAt: input.startsAt, endsAt: input.endsAt },
          now,
        );
      }

      const created = await tx.promotionalBanner.create({
        data: { ...input, createdByAdminUserId: ctx.actorId },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "BANNER_CREATED",
          entityType: "promotional_banner",
          entityId: created.id,
          after: {
            placement: created.placement,
            isActive: created.isActive,
            startsAt: created.startsAt?.toISOString() ?? null,
            endsAt: created.endsAt?.toISOString() ?? null,
          },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { ...created, state: deriveBannerState(created, now) };
    });
  }

  /**
   * Removes a banner permanently, whatever state it is in.
   *
   * ACTIVE BANNERS ARE DELETABLE ON PURPOSE. Making someone deactivate
   * first would be a step that protects nothing — the row is going
   * either way — and it invites a half-finished removal where a banner
   * is dark but still listed. Deleting a live one drops it from the
   * public strip immediately, because the public read then has no row
   * to find.
   *
   * Under the placement lock, like every other write here. The
   * concurrent limit is NOT re-checked: deleting can only reduce how
   * many banners are live at once. The lock still matters, because a
   * reorder running at the same instant would otherwise be renumbering
   * a row that is disappearing underneath it.
   *
   * SORT ORDER IS LEFT WITH A GAP. Order is relative, nothing reads the
   * numbers as a sequence, and reordering rebuilds them whenever an
   * operator actually rearranges the list. Renumbering every remaining
   * row here would be writes spent on something nobody can see.
   *
   * Returns nothing: the caller has no use for a row that no longer
   * exists.
   */
  async delete(id: string, ctx: BannerActorContext): Promise<void> {
    const existing = await this.prisma.promotionalBanner.findUnique({
      where: { id },
      select: { placement: true },
    });
    if (!existing) throw new NotFoundException("Banner not found");

    const orphanedKeys = await this.withPlacementLock(
      existing.placement,
      async (tx) => {
        // Re-read INSIDE the lock: between the lookup above and this line
        // another admin may have deleted the very same banner.
        const current = await tx.promotionalBanner.findUnique({
          where: { id },
          include: {
            images: {
              select: { locale: true, objectKey: true, thumbnailKey: true },
            },
          },
        });
        if (!current) throw new NotFoundException("Banner not found");

        // Read the keys BEFORE the row goes: the artwork rows cascade away
        // with it, and after the delete there is nothing left to ask.
        const keys = current.images.flatMap((image) => [
          image.objectKey,
          image.thumbnailKey,
        ]);

        // The artwork rows are removed by ON DELETE CASCADE.
        await tx.promotionalBanner.delete({ where: { id } });

        await this.audit.log(
          {
            actorType: AuditActorType.ADMIN,
            actorId: ctx.actorId,
            action: "BANNER_DELETED",
            entityType: "promotional_banner",
            entityId: id,
            // What it WAS, so the record answers "what did we lose".
            //
            // NO OBJECT KEYS. Those are internal storage addresses, and
            // recording them would turn the audit trail into an index of
            // them. Whether an image existed is the part a reviewer
            // actually needs.
            before: {
              placement: current.placement,
              isActive: current.isActive,
              sortOrder: current.sortOrder,
              // WHICH LANGUAGES had artwork, so the record answers what was
              // lost without naming a single storage key.
              imageLocales: current.images.map((image) =>
                toLocaleCode(image.locale),
              ),
              startsAt: current.startsAt?.toISOString() ?? null,
              endsAt: current.endsAt?.toISOString() ?? null,
            },
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
          tx,
        );

        return keys;
      },
    );

    // Committed. Nothing references these bytes any more.
    await this.images.discardStoredImages(id, orphanedKeys);
  }
}
