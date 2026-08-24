import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { AuditService } from "../src/audit/audit.service";
import { SettingsService } from "../src/settings/settings.service";
import { BannerPolicyService } from "../src/settings/banner-policy.service";
import { BannerService } from "../src/banners/banner.service";

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
 * whatever the mock says and never deserializes anything. The whole
 * 2100-test unit suite stayed green while three of the four banner
 * mutations were completely broken.
 *
 * Every mutation that takes the lock is covered below, because they all
 * failed for the same reason and a fix to one is a fix to all.
 */

const prisma = new PrismaClient() as unknown as PrismaService;

function service(): BannerService {
  const audit = new AuditService(prisma);
  return new BannerService(
    prisma,
    audit,
    new BannerPolicyService(prisma, new SettingsService(prisma), audit)
  );
}

const CTX = {
  actorId: "00000000-0000-4000-8000-00000000ad11",
  requestId: "banner-lock-integration-spec",
};

/**
 * Every row this file creates carries this prefix, so `afterAll` can
 * remove exactly what it made and nothing else.
 *
 * This suite runs against a REAL database — the same one a developer
 * browses locally. A banner left behind is not inert: one of these is
 * created ACTIVE, and an active banner in PUBLIC_HOME renders on the
 * public homepage. A test that leaves visible content in a database
 * someone is using is a test that damages the thing it verifies.
 */
const FIXTURE_PREFIX = "LOCKSPEC";

/** Distinct per run so repeated runs never collide on content. */
function uniqueTitle(what: string): string {
  return `${FIXTURE_PREFIX} ${what} ${process.hrtime.bigint()}`;
}

function newBannerInput(overrides: Record<string, unknown> = {}) {
  return {
    placement: "PUBLIC_HOME" as const,
    titleAr: uniqueTitle("ar"),
    titleEn: uniqueTitle("en"),
    bodyAr: null,
    bodyEn: null,
    // The founder's exact case: a home-placement banner with NO link.
    linkUrl: null,
    sortOrder: 0,
    isActive: false,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

describe("banner placement lock (integration, real DB)", () => {
  afterAll(async () => {
    const client = prisma as unknown as PrismaClient;
    // Remove only this file's own fixtures, matched on the prefix it
    // stamps into every title it creates. Audit rows are left alone:
    // they record that the action happened, which remains true.
    await client.promotionalBanner.deleteMany({
      where: { titleEn: { startsWith: FIXTURE_PREFIX } },
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

  it("activating a banner goes through the same lock", async () => {
    const svc = service();
    const created = await svc.create(newBannerInput(), CTX);

    const activated = await svc.setActive(created.id, true, CTX);
    expect(activated.isActive).toBe(true);
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

  it("creating an ACTIVE banner takes the lock on the create path too", async () => {
    // isActive:false skips the limit check; isActive:true does not, so
    // this exercises the branch that reads the window under the lock.
    await expect(
      service().create(newBannerInput({ isActive: true }), CTX)
    ).resolves.toBeTruthy();
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
});
