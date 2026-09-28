import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { AuditService } from "../src/audit/audit.service";
import { SettingsService } from "../src/settings/settings.service";
import { BannerPolicyService } from "../src/settings/banner-policy.service";
import { BannerService } from "../src/banners/banner.service";
import type { BannerImageService } from "../src/banners/banner-image.service";

/**
 * Creating a banner, against a real PostgreSQL.
 *
 * Why this needs a real database
 * ------------------------------
 * `POST /admin/banners` answered 500 for every request:
 *
 *   Failed to deserialize column of type 'void'
 *
 * `withPlacementLock` ran the advisory lock through `tx.$queryRaw`.
 * `pg_advisory_xact_lock()` returns SQL `void`; `$queryRaw` deserializes
 * every column it gets back and Prisma has no mapping for `void`, so the
 * statement threw before any banner work happened. `$executeRaw` returns
 * a row count and never looks at columns, which is what taking a lock
 * needs.
 *
 * NO UNIT TEST COULD CATCH THIS. The failure lives entirely in the
 * Prisma/Postgres wire protocol — a mocked transaction client returns
 * whatever the mock says and never deserializes anything. The whole unit
 * suite stayed green while three of the four banner mutations were
 * completely broken.
 *
 * Every mutation that takes the lock is covered below, because they all
 * failed for the same reason and a fix to one is a fix to all.
 */

const prisma = new PrismaClient() as unknown as PrismaService;

/**
 * Every row this file creates is stamped with THIS actor id, so
 * `afterAll` can remove exactly what it made and nothing else.
 *
 * It used to match on a title prefix. Banners no longer have titles —
 * they are artwork and nothing else — so the creating admin identifies
 * these rows now. It is a better handle anyway: a title was operator
 * content that happened to be unique, while this is the field that
 * actually records who made the row.
 *
 * This suite runs against a REAL database — the same one a developer
 * browses locally. A banner left behind is not inert: an active banner
 * in PUBLIC_HOME renders on the public homepage. A test that leaves
 * visible content in a database someone is using is a test that damages
 * the thing it verifies.
 */
const FIXTURE_ACTOR = "00000000-0000-4000-8000-00000000ad11";

const CTX = {
  actorId: FIXTURE_ACTOR,
  requestId: "banner-lock-integration-spec",
};

function service(): BannerService {
  const audit = new AuditService(prisma);
  return new BannerService(
    prisma,
    audit,
    new BannerPolicyService(prisma, new SettingsService(prisma), audit),
    // Never reached by the lock tests themselves; the delete test below
    // only needs it not to throw.
    { discardStoredImages: async () => undefined } as unknown as BannerImageService
  );
}

function newBannerInput(overrides: Record<string, unknown> = {}) {
  return {
    placement: "PUBLIC_HOME" as const,
    // The founder's exact case: a home-placement banner with NO link.
    linkUrl: null,
    sortOrder: 0,
    isActive: false,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

/** Gives a banner complete artwork for one language. */
async function addArtwork(bannerId: string, locale: "AR_SA" | "EN_SA"): Promise<void> {
  await (prisma as unknown as PrismaClient).bannerImage.create({
    data: {
      bannerId,
      locale,
      objectKey: `banners/${bannerId}/${locale}/main.jpg`,
      thumbnailKey: `banners/${bannerId}/${locale}/thumb.jpg`,
      contentType: "image/jpeg",
      etag: `etag-${locale}`,
      thumbnailETag: `etag-thumb-${locale}`,
      width: 2000,
      height: 400,
    },
  });
}

describe("banner placement lock (integration, real DB)", () => {
  afterAll(async () => {
    const client = prisma as unknown as PrismaClient;
    // Artwork rows cascade with their banner. Audit rows are left alone:
    // they record that the action happened, which remains true.
    await client.promotionalBanner.deleteMany({
      where: { createdByAdminUserId: FIXTURE_ACTOR },
    });
    await client.$disconnect();
  });

  it("creates a home banner with no link — the request that returned 500", async () => {
    const created = await service().create(newBannerInput(), CTX);

    expect(created).toBeTruthy();
    expect(created.placement).toBe("PUBLIC_HOME");
    expect(created.linkUrl).toBeNull();

    const stored = await (prisma as unknown as PrismaClient).promotionalBanner.findUnique({
      where: { id: created.id },
    });
    expect(stored).not.toBeNull();
    expect(stored!.linkUrl).toBeNull();
  });

  it("takes the advisory lock without a deserialization error", async () => {
    // The precise regression: any reintroduction of $queryRaw here fails
    // with this message rather than some generic error.
    await expect(service().create(newBannerInput(), CTX)).resolves.toBeTruthy();
  });

  it("activating a banner with BOTH images goes through the same lock", async () => {
    const svc = service();
    const created = await svc.create(newBannerInput(), CTX);
    await addArtwork(created.id, "AR_SA");
    await addArtwork(created.id, "EN_SA");

    const activated = await svc.setActive(created.id, true, CTX);
    expect(activated.isActive).toBe(true);
  });

  it("REFUSES to activate a banner missing one language", async () => {
    // Against a real database, so the artwork read inside the lock is
    // the real one. Going live with one language would mean showing a
    // reader either the wrong language's picture or an empty frame.
    const svc = service();
    const created = await svc.create(newBannerInput(), CTX);
    await addArtwork(created.id, "AR_SA");

    await expect(svc.setActive(created.id, true, CTX)).rejects.toThrow(/en-SA/);

    const stored = await (prisma as unknown as PrismaClient).promotionalBanner.findUnique({
      where: { id: created.id },
    });
    expect(stored!.isActive).toBe(false);
  });

  it("refuses to activate a banner with no artwork at all", async () => {
    const svc = service();
    const created = await svc.create(newBannerInput(), CTX);

    await expect(svc.setActive(created.id, true, CTX)).rejects.toThrow(/ar-SA/);
  });

  it("scheduling a banner goes through the same lock", async () => {
    const svc = service();
    const created = await svc.create(newBannerInput(), CTX);

    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(Date.now() + 7_200_000);
    const scheduled = await svc.setSchedule(created.id, { startsAt, endsAt }, CTX);

    expect(scheduled.startsAt).not.toBeNull();
    expect(scheduled.endsAt).not.toBeNull();
  });

  it("still rejects an end before a start, so the guard survived the fix", async () => {
    const now = Date.now();
    await expect(
      service().create(
        newBannerInput({
          startsAt: new Date(now + 7_200_000),
          endsAt: new Date(now + 3_600_000),
        }),
        CTX
      )
    ).rejects.toThrow(/endsAt must be after startsAt/);
  });

  it("deletes a banner and its artwork rows together", async () => {
    const svc = service();
    const created = await svc.create(newBannerInput(), CTX);
    await addArtwork(created.id, "AR_SA");
    await addArtwork(created.id, "EN_SA");

    await svc.delete(created.id, CTX);

    const client = prisma as unknown as PrismaClient;
    expect(await client.promotionalBanner.findUnique({ where: { id: created.id } })).toBeNull();
    // ON DELETE CASCADE, proven against the real constraint rather than
    // assumed from the schema.
    expect(await client.bannerImage.count({ where: { bannerId: created.id } })).toBe(0);
  });
});
