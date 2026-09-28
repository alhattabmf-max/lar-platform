import { PrismaClient } from "@prisma/client";
import { checkoutFixturePrisma, seedCheckoutFixture } from "./fixtures/checkout.fixture";

/**
 * THE SUITES WRITE TO `platform_test`, AND NOWHERE ELSE.
 *
 * This is not a rule about intent — it is asked of the live connection.
 * `current_database()` is Postgres answering where this client actually
 * landed, after every config, every `.env` and every default has had
 * its say.
 *
 * WHY IT IS WORTH A TEST. Until `test/setup-test-database.ts` existed,
 * `@prisma/client` loaded `apps/api/.env` on import and every suite ran
 * against `platform_dev` — the database the owner develops against, and
 * the one the marketplace page reads. Nothing cleaned up, so months of
 * runs left 17,370 companies, 23,408 cities and 8,075 taxonomy nodes in
 * it, and the page that loads all three took thirteen seconds.
 *
 * A comment in a config would not have caught that, and did not. This
 * does: it fails the moment a suite is pointed anywhere else.
 */
describe("test suites are isolated from the development database", () => {
  afterAll(async () => {
    await (checkoutFixturePrisma as unknown as PrismaClient).$disconnect();
  });

  it("a plain PrismaClient — the kind every fixture builds — lands in platform_test", async () => {
    const plain = new PrismaClient();
    try {
      const [{ db }] = await plain.$queryRawUnsafe<{ db: string }[]>(
        "SELECT current_database() AS db"
      );
      expect(db).toBe("platform_test");
    } finally {
      await plain.$disconnect();
    }
  });

  it("the shared fixture client lands there too", async () => {
    const [{ db }] = await (
      checkoutFixturePrisma as unknown as PrismaClient
    ).$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
    expect(db).toBe("platform_test");
  });

  it("never platform_dev, whatever the environment says", () => {
    // THE VARIABLE ITSELF, so a failure names the cause rather than a
    // symptom two layers down.
    expect(process.env.DATABASE_URL).toContain("platform_test");
    expect(process.env.DATABASE_URL).not.toContain("platform_dev");
  });

  it("and a seeded fixture's rows are written there", async () => {
    // THE PROOF THAT MATTERS: not where a connection points, but where
    // a WRITE lands. A fixture seeds the full shape — supplier, trader,
    // product, branches, a published offer — and the row is then found
    // in the test database.
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "DBISOLATION" });

    const [{ db }] = await (
      checkoutFixturePrisma as unknown as PrismaClient
    ).$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
    expect(db).toBe("platform_test");

    const written = await checkoutFixturePrisma.opportunity.findUnique({
      where: { id: fixture.opportunityId },
      select: { id: true },
    });
    expect(written).not.toBeNull();
  }, 60_000);
});
