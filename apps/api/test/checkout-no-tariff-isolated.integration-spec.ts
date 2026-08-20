import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { CheckoutSessionService } from "../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../src/settings/checkout-settings.service";
import { AuditService } from "../src/audit/audit.service";

const ISOLATED_DB = "platform_checkout_no_tariff_test";
const ISOLATED_URL = `postgresql://platform:platform@localhost:5432/${ISOLATED_DB}?schema=public`;

describe("Checkout without any configured shipping tariff — isolated empty DB (integration, real Postgres)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    execSync(`PGPASSWORD=platform psql -h localhost -U platform -d postgres -c "DROP DATABASE IF EXISTS ${ISOLATED_DB};"`, {
      stdio: "pipe",
    });
    execSync(`PGPASSWORD=platform psql -h localhost -U platform -d postgres -c "CREATE DATABASE ${ISOLATED_DB} OWNER platform;"`, {
      stdio: "pipe",
    });
    execSync(`DATABASE_URL="${ISOLATED_URL}" npx prisma migrate deploy`, {
      cwd: `${__dirname}/..`,
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasources: { db: { url: ISOLATED_URL } } });
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    execSync(`PGPASSWORD=platform psql -h localhost -U platform -d postgres -c "DROP DATABASE IF EXISTS ${ISOLATED_DB};"`, {
      stdio: "pipe",
    });
  });

  it("no shipping_tariff_policy_versions row exists on a fresh migrate-deploy install", async () => {
    const count = await prisma.shippingTariffPolicyVersion.count();
    expect(count).toBe(0);
  });

  it("checkout is rejected with SHIPPING_TARIFF_NOT_CONFIGURED before any write — zero rows in Session/Quote/Allocations/IdempotencyKey", async () => {
    const supplier = await prisma.company.create({
      data: { crNumber: `CR-NOTARIFF-${Date.now()}`, legalName: "s", accountType: "SUPPLIER", verificationStatus: "VERIFIED" },
    });
    const trader = await prisma.company.create({
      data: { crNumber: `CR-NOTARIFFT-${Date.now()}`, legalName: "t", accountType: "TRADER", verificationStatus: "VERIFIED" },
    });
    const traderUser = await prisma.user.create({
      data: {
        companyId: trader.id,
        email: `notariff-${Date.now()}@example.com`,
        passwordHash: "x",
        primaryMobile1: "+966500000001",
        primaryMobile2: "+966500000002",
        emailVerificationStatus: "VERIFIED",
      },
    });
    const node = await prisma.taxonomyNode.create({ data: { nameAr: "a", nameEn: "a" } });
    const product = await prisma.product.create({
      data: {
        companyId: supplier.id,
        taxonomyNodeId: node.id,
        salesUnitNameAr: "a",
        salesUnitNameEn: "a",
        nameAr: "p",
        nameEn: "p",
        approvalStatus: "APPROVED",
        weightPerUnit: 1,
        lengthCm: 1,
        widthCm: 1,
        heightCm: 1,
      },
    });
    const snapshot = await prisma.productApprovalSnapshot.create({
      data: { productId: product.id, approvalSource: "AUTO", snapshot: {} },
    });
    const region = await prisma.region.create({ data: { nameAr: "r", nameEn: "r" } });
    const city = await prisma.city.create({ data: { regionId: region.id, nameAr: "c", nameEn: "c" } });
    const supplierLoc = await prisma.companyLocation.create({
      data: {
        companyId: supplier.id,
        cityId: city.id,
        name: "s-loc",
        shortAddress: "a",
        latitude: 1,
        longitude: 1,
        contactName: "n",
        contactPhone: "p",
        isDefault: true,
      },
    });
    const traderLoc = await prisma.companyLocation.create({
      data: {
        companyId: trader.id,
        cityId: city.id,
        name: "t-loc",
        shortAddress: "a",
        latitude: 1,
        longitude: 1,
        contactName: "n",
        contactPhone: "p",
        isDefault: true,
      },
    });
    const policyV1 = await prisma.shareTierPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });
    const commissionV1 = await prisma.commissionPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });
    const opportunity = await prisma.opportunity.create({
      data: {
        companyId: supplier.id,
        productId: product.id,
        fulfillmentLocationId: supplierLoc.id,
        fulfillmentCityId: city.id,
        fulfillmentCityNameAr: "c",
        fulfillmentCityNameEn: "c",
        fulfillmentRegionId: region.id,
        fulfillmentRegionNameAr: "r",
        fulfillmentRegionNameEn: "r",
        productApprovalSnapshotId: snapshot.id,
        targetQuantity: 40,
        unitPriceAmount: 10,
        startAt: new Date(Date.now() - 3600_000),
        endAt: new Date(Date.now() + 5 * 24 * 3600_000),
        expectedPreparationDays: 3,
        status: "ACTIVE",
        firstActivatedAt: new Date(Date.now() - 3600_000),
        taxRatePercent: 15,
        unitPriceExclTaxAmount: 8.7,
        unitTaxAmount: 1.3,
        taxCalculationRuleCode: "DEFAULT",
        taxCalculationRuleVersion: "v1",
        totalValueInclTaxAmount: 400,
        shareTierPolicyVersionId: policyV1.id,
        shareTierIndex: 0,
        shareBasisPoints: 1000,
        shareQuantity: 4,
        salesUnitNameAr: "a",
        salesUnitNameEn: "a",
        commissionPolicyVersionId: commissionV1.id,
        commissionRateBasisPoints: commissionV1.rateBasisPoints,
      },
    });

    const service = new CheckoutSessionService(
      prisma as unknown as PrismaService,
      new ShippingTariffPolicyService(prisma as unknown as PrismaService, new AuditService(prisma as unknown as PrismaService)),
      new CheckoutSettingsService(prisma as unknown as PrismaService, new AuditService(prisma as unknown as PrismaService))
    );

    await expect(
      service.create(
        { opportunityId: opportunity.id, quantity: 4, allocations: [{ companyLocationId: traderLoc.id, quantity: 4 }] },
        "no-tariff-key",
        { userId: traderUser.id, companyId: trader.id, requestId: "req-1" }
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "SHIPPING_TARIFF_NOT_CONFIGURED" }) });

    const sessionCount = await prisma.checkoutSession.count();
    const quoteCount = await prisma.quoteSnapshot.count();
    const allocationCount = await prisma.checkoutLocationAllocation.count();
    const idempotencyCount = await prisma.idempotencyKey.count();

    expect(sessionCount).toBe(0);
    expect(quoteCount).toBe(0);
    expect(allocationCount).toBe(0);
    expect(idempotencyCount).toBe(0);
  }, 30_000);
});
