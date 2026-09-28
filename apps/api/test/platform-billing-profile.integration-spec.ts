import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { PrismaService } from "../src/database/prisma.service";
import { PlatformBillingProfileService } from "../src/invoicing/platform-billing-profile.service";
import { checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { uniqueCrNumber, uniqueVatNumber } from "./fixtures/unique";

// ONE REGISTRATION NUMBER PER SCENARIO, PER RUN.
//
// These specs write a version and then count the versions carrying
// that number. The table is append-only and nothing cleans it, so a
// fixed literal accumulated a row on every run until «exactly one
// version» found seventeen. The assertions are unchanged; the rows
// they count are now this run's own.
const CR_PLATFORM_V1 = uniqueCrNumber("CR-PLATFORM-V1");
const CR_PLATFORM_V2 = uniqueCrNumber("CR-PLATFORM-V2");
const CR_CITYSNAP = uniqueCrNumber("CR-CITYSNAP");
const CR_IMMUTABLE = uniqueCrNumber("CR-IMMUTABLE");
const CR_NOVAT = uniqueCrNumber("CR-NOVAT");
const CR_EMPTYADDR = uniqueCrNumber("CR-EMPTYADDR");
const CR_NOCITY = uniqueCrNumber("CR-NOCITY");
const CR_NOSHORT = uniqueCrNumber("CR-NOSHORT");
const CR_DOUBLE = uniqueCrNumber("CR-DOUBLE");
const CR_REUSE_1 = uniqueCrNumber("CR-REUSE-1");
const CR_REUSE_2 = uniqueCrNumber("CR-REUSE-2");
const CR_CONCURRENT = uniqueCrNumber("CR-CONCURRENT");
const CR_AUDITSAFE = uniqueCrNumber("CR-AUDITSAFE");


const prisma = checkoutFixturePrisma;

function buildService(p: PrismaService = prisma as unknown as PrismaService) {
  return new PlatformBillingProfileService(p);
}
const adminCtx = () => ({
  userId: randomUUID(),
  requestId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

/**
 * A REAL CITY, read from the database.
 *
 * The address no longer takes a typed city name — it takes a `cityId`
 * that the service resolves against the `cities` table and snapshots the
 * names from. A fixture city id would prove nothing about that.
 */
async function activeCity() {
  const city = await prisma.city.findFirst({
    where: { isActive: true },
    select: { id: true, nameAr: true, nameEn: true },
  });
  if (!city) throw new Error("no active city in the database to test against");
  return city;
}

const address = (cityId: string) => ({ cityId, shortAddress: "RRRD2929" });

describe("PlatformBillingProfileService (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("creating a new version never updates an existing row — append-only, versions increment", async () => {
    const service = buildService();
    const city = await activeCity();
    const before = await service.listAll();
    const startVersion = before[0]?.version ?? 0;

    const v1 = await service.createNewVersion(
      {
        legalName: "FORSA Platform v1 Test",
        crNumber: CR_PLATFORM_V1,
        isVatRegistered: false,
        addressSnapshot: address(city.id),
      },
      adminCtx(),
      randomUUID(),
    );
    const v2 = await service.createNewVersion(
      {
        legalName: "FORSA Platform v2 Test",
        crNumber: CR_PLATFORM_V2,
        isVatRegistered: true,
        vatNumber: "300000000000003",
        addressSnapshot: address(city.id),
      },
      adminCtx(),
      randomUUID(),
    );

    expect(v2.version).toBe(v1.version + 1);
    expect(v1.version).toBeGreaterThan(startVersion);

    const currentAfter = await service.getCurrent();
    expect(currentAfter?.id).toBe(v2.id);

    // The FIRST version's row is untouched — still exactly as created.
    const v1Reread = await prisma.platformBillingProfileVersion.findUniqueOrThrow({
      where: { id: v1.id },
    });
    expect(v1Reread.legalName).toBe("FORSA Platform v1 Test");
  }, 15_000);

  it("snapshots the city's names rather than taking them from the caller", async () => {
    const service = buildService();
    const city = await activeCity();

    const created = await service.createNewVersion(
      {
        legalName: "City Snapshot Test",
        crNumber: CR_CITYSNAP,
        isVatRegistered: false,
        addressSnapshot: address(city.id),
      },
      adminCtx(),
      randomUUID(),
    );

    const stored = created.addressSnapshot as Record<string, unknown>;
    // A document computed against this version must still read the same
    // if the city is renamed next year — which is why the name is beside
    // the id and not looked up at render time.
    expect(stored.cityId).toBe(city.id);
    expect(stored.cityNameAr).toBe(city.nameAr);
    expect(stored.cityNameEn).toBe(city.nameEn);
    expect(stored.shortAddress).toBe("RRRD2929");
  }, 15_000);

  it("DB: the version row is immutable — UPDATE and DELETE are both rejected", async () => {
    const service = buildService();
    const city = await activeCity();
    const profile = await service.createNewVersion(
      {
        legalName: "Immutable Platform Test",
        crNumber: CR_IMMUTABLE,
        isVatRegistered: false,
        addressSnapshot: address(city.id),
      },
      adminCtx(),
      randomUUID(),
    );
    await expect(
      prisma.$executeRaw`UPDATE platform_billing_profile_versions SET legal_name = 'tampered' WHERE id = ${profile.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`DELETE FROM platform_billing_profile_versions WHERE id = ${profile.id}::uuid`,
    ).rejects.toThrow();
  }, 15_000);

  it("rejects isVatRegistered=true without a valid vatNumber", async () => {
    const service = buildService();
    const city = await activeCity();
    await expect(
      service.createNewVersion(
        {
          legalName: "No VAT Number Test",
          crNumber: CR_NOVAT,
          isVatRegistered: true,
          addressSnapshot: address(city.id),
        },
        adminCtx(),
        randomUUID(),
      ),
    ).rejects.toThrow();
  }, 15_000);

  describe("the address is a shape now, not any object at all", () => {
    it("REFUSES an empty address", async () => {
      const service = buildService();
      // `{}` satisfied `@IsObject()` exactly, and the commission document
      // copies the blob onto itself as the seller's address.
      await expect(
        service.createNewVersion(
          {
            legalName: "Empty Address Test",
            crNumber: CR_EMPTYADDR,
            isVatRegistered: false,
            addressSnapshot: {} as never,
          },
          adminCtx(),
          randomUUID(),
        ),
      ).rejects.toThrow();
    }, 15_000);

    it("REFUSES a city id that names no city", async () => {
      const service = buildService();
      await expect(
        service.createNewVersion(
          {
            legalName: "Unknown City Test",
            crNumber: CR_NOCITY,
            isVatRegistered: false,
            addressSnapshot: address(randomUUID()),
          },
          adminCtx(),
          randomUUID(),
        ),
      ).rejects.toThrow();
    }, 15_000);

    it("REFUSES an empty short address", async () => {
      const service = buildService();
      const city = await activeCity();
      await expect(
        service.createNewVersion(
          {
            legalName: "Empty Short Address Test",
            crNumber: CR_NOSHORT,
            isVatRegistered: false,
            addressSnapshot: { cityId: city.id, shortAddress: "   " },
          },
          adminCtx(),
          randomUUID(),
        ),
      ).rejects.toThrow();
    }, 15_000);
  });

  describe("a version is permanent, so it is written once", () => {
    it("replays the same key rather than appending a second version", async () => {
      const service = buildService();
      const city = await activeCity();
      const key = randomUUID();
      const body = {
        legalName: "Double Press Test",
        crNumber: CR_DOUBLE,
        isVatRegistered: false,
        addressSnapshot: address(city.id),
      };

      const first = await service.createNewVersion(body, adminCtx(), key);
      const second = await service.createNewVersion(body, adminCtx(), key);

      // THE DOUBLE PRESS. Disabling the button is a courtesy; this is
      // what actually stops a second permanent version.
      expect(second.id).toBe(first.id);
      expect(second.version).toBe(first.version);

      const rows = await prisma.platformBillingProfileVersion.findMany({
        where: { crNumber: CR_DOUBLE },
      });
      expect(rows).toHaveLength(1);
    }, 20_000);

    it("refuses the same key carrying a different profile", async () => {
      const service = buildService();
      const city = await activeCity();
      const key = randomUUID();

      await service.createNewVersion(
        {
          legalName: "Key Reuse First",
          crNumber: CR_REUSE_1,
          isVatRegistered: false,
          addressSnapshot: address(city.id),
        },
        adminCtx(),
        key,
      );

      // Silently replaying the first result here would tell an operator
      // their SECOND, different profile was saved when it was not.
      await expect(
        service.createNewVersion(
          {
            legalName: "Key Reuse Second",
            crNumber: CR_REUSE_2,
            isVatRegistered: false,
            addressSnapshot: address(city.id),
          },
          adminCtx(),
          key,
        ),
      ).rejects.toMatchObject({ status: 409 });
    }, 20_000);

    it("writes ONE version when two requests race with the same key", async () => {
      const service = buildService();
      const city = await activeCity();
      const key = randomUUID();
      const body = {
        legalName: "Concurrent Test",
        crNumber: CR_CONCURRENT,
        isVatRegistered: false,
        addressSnapshot: address(city.id),
      };

      // Two operators pressing at the same instant, or one browser
      // retrying a request it believed had timed out.
      const [a, b] = await Promise.all([
        service.createNewVersion(body, adminCtx(), key),
        service.createNewVersion(body, adminCtx(), key),
      ]);

      expect(a.id).toBe(b.id);
      const rows = await prisma.platformBillingProfileVersion.findMany({
        where: { crNumber: CR_CONCURRENT },
      });
      expect(rows).toHaveLength(1);
    }, 20_000);

    it("writes TWO versions for two different keys, because that is two intents", async () => {
      const service = buildService();
      const city = await activeCity();
      const body = (n: number) => ({
        legalName: `Distinct Intent ${n}`,
        crNumber: `CR-DISTINCT-${n}`,
        isVatRegistered: false,
        addressSnapshot: address(city.id),
      });

      const first = await service.createNewVersion(body(1), adminCtx(), randomUUID());
      const second = await service.createNewVersion(body(2), adminCtx(), randomUUID());

      expect(second.version).toBe(first.version + 1);
    }, 20_000);
  });

  it("audit and outbox never contain the platform's vatNumber or raw legal name", async () => {
    const service = buildService();
    const city = await activeCity();
    const secretVat = uniqueVatNumber();
    const secretName = "Extremely Secret Platform Legal Name";
    const profile = await service.createNewVersion(
      {
        legalName: secretName,
        crNumber: CR_AUDITSAFE,
        isVatRegistered: true,
        vatNumber: secretVat,
        addressSnapshot: address(city.id),
      },
      adminCtx(),
      randomUUID(),
    );

    const audits = await prisma.auditLog.findMany({
      where: {
        entityType: "platform_billing_profile_version",
        entityId: profile.id,
      },
    });
    expect(audits.length).toBeGreaterThan(0);
    for (const entry of audits) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(secretVat);
      expect(serialized).not.toContain(secretName);
    }

    const outboxEvents = await prisma.outboxEvent.findMany({
      where: { eventType: "PLATFORM_BILLING_PROFILE_VERSION_CREATED" },
    });
    for (const evt of outboxEvents) {
      const serialized = JSON.stringify(evt);
      expect(serialized).not.toContain(secretVat);
      expect(serialized).not.toContain(secretName);
    }
  }, 15_000);
});
