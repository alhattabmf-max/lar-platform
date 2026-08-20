import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { PlatformBillingProfileService } from "../src/invoicing/platform-billing-profile.service";
import { checkoutFixturePrisma } from "./fixtures/checkout.fixture";

const prisma = checkoutFixturePrisma;

function buildService(p: PrismaService = prisma as unknown as PrismaService) {
  return new PlatformBillingProfileService(p);
}
const adminCtx = () => ({ userId: crypto.randomUUID(), requestId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });

describe("PlatformBillingProfileService (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("creating a new version never updates an existing row — Append-only, versions increment", async () => {
    const service = buildService();
    const before = await service.listAll();
    const startVersion = before[0]?.version ?? 0;

    const v1 = await service.createNewVersion(
      { legalName: "FORSA Platform v1 Test", crNumber: "CR-PLATFORM-V1", isVatRegistered: false, addressSnapshot: { city: "Riyadh" } },
      adminCtx()
    );
    const v2 = await service.createNewVersion(
      { legalName: "FORSA Platform v2 Test", crNumber: "CR-PLATFORM-V2", isVatRegistered: true, vatNumber: "300000000000003", addressSnapshot: { city: "Jeddah" } },
      adminCtx()
    );

    expect(v2.version).toBe(v1.version + 1);
    expect(v1.version).toBeGreaterThan(startVersion);

    const currentAfter = await service.getCurrent();
    expect(currentAfter?.id).toBe(v2.id);

    // The FIRST version's row is untouched — still exists exactly as created.
    const v1Reread = await prisma.platformBillingProfileVersion.findUniqueOrThrow({ where: { id: v1.id } });
    expect(v1Reread.legalName).toBe("FORSA Platform v1 Test");
  }, 15_000);

  it("DB: the version row is immutable — UPDATE and DELETE are both rejected", async () => {
    const service = buildService();
    const profile = await service.createNewVersion(
      { legalName: "Immutable Platform Test", crNumber: "CR-IMMUTABLE", isVatRegistered: false, addressSnapshot: {} },
      adminCtx()
    );
    await expect(prisma.$executeRaw`UPDATE platform_billing_profile_versions SET legal_name = 'tampered' WHERE id = ${profile.id}::uuid`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM platform_billing_profile_versions WHERE id = ${profile.id}::uuid`).rejects.toThrow();
  }, 15_000);

  it("rejects isVatRegistered=true without a valid vatNumber", async () => {
    const service = buildService();
    await expect(
      service.createNewVersion({ legalName: "No VAT Number Test", crNumber: "CR-NOVAT", isVatRegistered: true, addressSnapshot: {} }, adminCtx())
    ).rejects.toThrow();
  }, 15_000);

  it("Audit and Outbox never contain the platform's vatNumber or raw legal name", async () => {
    const service = buildService();
    const secretVat = "777888999000111";
    const secretName = "Extremely Secret Platform Legal Name";
    const profile = await service.createNewVersion(
      { legalName: secretName, crNumber: "CR-AUDITSAFE", isVatRegistered: true, vatNumber: secretVat, addressSnapshot: {} },
      adminCtx()
    );

    const audits = await prisma.auditLog.findMany({ where: { entityType: "platform_billing_profile_version", entityId: profile.id } });
    expect(audits.length).toBeGreaterThan(0);
    for (const entry of audits) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(secretVat);
      expect(serialized).not.toContain(secretName);
    }

    const outboxEvents = await prisma.outboxEvent.findMany({ where: { eventType: "PLATFORM_BILLING_PROFILE_VERSION_CREATED" } });
    for (const evt of outboxEvents) {
      const serialized = JSON.stringify(evt);
      expect(serialized).not.toContain(secretVat);
      expect(serialized).not.toContain(secretName);
    }
  }, 15_000);
});
