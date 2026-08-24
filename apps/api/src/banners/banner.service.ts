import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType, Prisma, type BannerPlacement } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BannerPolicyService } from "../settings/banner-policy.service";
import { BusinessException } from "../common/errors/business-exception";
import { LIVE_BANNER_CONDITION, SELECT_DB_NOW, placementLock } from "./banner-visibility.sql";
import { checkOverlap, deriveBannerState, type BannerWindow } from "./banner-window.util";

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
const PUBLIC_COLUMNS = Prisma.sql`
  id, title_ar, title_en, body_ar, body_en, link_url,
  image_object_key IS NOT NULL AS has_image
`;

interface PublicBannerRow {
  id: string;
  title_ar: string;
  title_en: string;
  body_ar: string | null;
  body_en: string | null;
  link_url: string | null;
  has_image: boolean;
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

export interface PublicBanner {
  id: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string | null;
  bodyEn: string | null;
  linkUrl: string | null;
  hasImage: boolean;
}

@Injectable()
export class BannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: BannerPolicyService
  ) {}

  // ----- public visibility -------------------------------------------------

  /**
   * Banners live RIGHT NOW in one placement, in display order.
   *
   * A single statement, so PostgreSQL's `now()` is the one transaction
   * timestamp for the whole predicate. `placement` and nothing else is
   * bound as a parameter — the condition itself is a fixed fragment.
   */
  async listLive(placement: BannerPlacement): Promise<PublicBanner[]> {
    const rows = await this.prisma.$queryRaw<PublicBannerRow[]>(Prisma.sql`
      SELECT ${PUBLIC_COLUMNS}
      FROM promotional_banners
      WHERE placement = ${placement}::"BannerPlacement"
        AND ${LIVE_BANNER_CONDITION}
      ORDER BY sort_order ASC, created_at ASC
    `);

    return rows.map((row) => ({
      id: row.id,
      titleAr: row.title_ar,
      titleEn: row.title_en,
      bodyAr: row.body_ar,
      bodyEn: row.body_en,
      linkUrl: row.link_url,
      hasImage: row.has_image,
    }));
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
  async findLiveImage(id: string): Promise<LiveBannerImageRow | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        image_object_key: string | null;
        image_thumbnail_key: string | null;
        image_content_type: string | null;
        image_etag: string | null;
        image_thumbnail_etag: string | null;
        image_updated_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT id, image_object_key, image_thumbnail_key, image_content_type,
             image_etag, image_thumbnail_etag, image_updated_at
      FROM promotional_banners
      WHERE id = ${id}::uuid
        AND ${LIVE_BANNER_CONDITION}
      LIMIT 1
    `);

    const row = rows[0];
    if (
      !row ||
      row.image_object_key === null ||
      row.image_thumbnail_key === null ||
      row.image_content_type === null ||
      row.image_etag === null ||
      row.image_thumbnail_etag === null ||
      row.image_updated_at === null
    ) {
      return null;
    }

    return {
      id: row.id,
      imageObjectKey: row.image_object_key,
      imageThumbnailKey: row.image_thumbnail_key,
      imageContentType: row.image_content_type,
      imageETag: row.image_etag,
      imageThumbnailETag: row.image_thumbnail_etag,
      imageUpdatedAt: row.image_updated_at,
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
          titleAr: true,
          titleEn: true,
          bodyAr: true,
          bodyEn: true,
          linkUrl: true,
          sortOrder: true,
          isActive: true,
          startsAt: true,
          endsAt: true,
          createdAt: true,
          updatedAt: true,
          imageObjectKey: true,
          imageWidth: true,
          imageHeight: true,
        },
      }),
      this.prisma.$queryRaw<Array<{ now: Date }>>(SELECT_DB_NOW),
    ]);

    return rows.map(({ imageObjectKey, ...row }) => ({
      ...row,
      hasImage: imageObjectKey !== null,
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
    fn: (tx: Prisma.TransactionClient, now: Date) => Promise<T>
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
    excludeId?: string
  ): Promise<void> {
    const { maxConcurrentLiveBannersPerPlacement } = await this.policy.getPolicy();

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
        `This schedule would put ${result.peak} banners live at once in this placement, exceeding the limit of ${result.maxConcurrent}`
      );
    }
  }

  /**
   * Activates or deactivates a banner.
   *
   * Only activation is checked: deactivating can never increase overlap.
   */
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
        await this.assertWithinConcurrentLimit(
          tx,
          current.placement,
          { id, startsAt: current.startsAt, endsAt: current.endsAt },
          now,
          id
        );
      }

      const updated = await tx.promotionalBanner.update({ where: { id }, data: { isActive } });

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
        tx
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
    ctx: BannerActorContext
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
        "endsAt must be after startsAt — the window is half-open and endsAt is exclusive"
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
          id
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
        tx
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
      titleAr?: string;
      titleEn?: string;
      bodyAr?: string | null;
      bodyEn?: string | null;
      linkUrl?: string | null;
      sortOrder?: number;
    },
    ctx: BannerActorContext
  ) {
    const current = await this.prisma.promotionalBanner.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Banner not found");

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.promotionalBanner.update({ where: { id }, data });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "BANNER_UPDATED",
          entityType: "promotional_banner",
          entityId: id,
          before: {
            titleAr: current.titleAr,
            titleEn: current.titleEn,
            linkUrl: current.linkUrl,
            sortOrder: current.sortOrder,
          },
          after: {
            titleAr: updated.titleAr,
            titleEn: updated.titleEn,
            linkUrl: updated.linkUrl,
            sortOrder: updated.sortOrder,
          },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx
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
  async reorder(placement: BannerPlacement, orderedIds: string[], ctx: BannerActorContext) {
    const duplicates = orderedIds.filter((id, i) => orderedIds.indexOf(id) !== i);
    if (duplicates.length > 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "reorder must not contain duplicate banner ids"
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.promotionalBanner.findMany({
        where: { placement },
        select: { id: true },
      });

      const existingIds = new Set(existing.map((b) => b.id));
      const sameSet =
        orderedIds.length === existing.length && orderedIds.every((id) => existingIds.has(id));

      if (!sameSet) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "reorder must include exactly the placement's current banner ids"
        );
      }

      for (const [index, id] of orderedIds.entries()) {
        await tx.promotionalBanner.update({ where: { id }, data: { sortOrder: index } });
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
        tx
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
      titleAr: string;
      titleEn: string;
      bodyAr: string | null;
      bodyEn: string | null;
      linkUrl: string | null;
      sortOrder: number;
      isActive: boolean;
      startsAt: Date | null;
      endsAt: Date | null;
    },
    ctx: BannerActorContext
  ) {
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "endsAt must be after startsAt — the window is half-open and endsAt is exclusive"
      );
    }

    return this.withPlacementLock(input.placement, async (tx, now) => {
      if (input.isActive) {
        await this.assertWithinConcurrentLimit(
          tx,
          input.placement,
          { id: "new", startsAt: input.startsAt, endsAt: input.endsAt },
          now
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
        tx
      );

      return { ...created, state: deriveBannerState(created, now) };
    });
  }
}
