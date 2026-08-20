import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface CheckoutFixture {
  opportunityId: string;
  supplierCompanyId: string;
  traderCompanyId: string;
  traderUserId: string;
  /** Same as traderLocations.sameCity — kept for existing tests that only need one branch. */
  traderLocationId: string;
  traderLocations: {
    sameCity: string;
    sameRegionDifferentCity: string;
    differentRegion: string;
  };
  tariffId: string;
}

/** Seeds a fully-published ACTIVE opportunity, a trader company with one active branch, and a shipping tariff — everything CheckoutSessionService needs, without going through the full HTTP registration flow. */
export async function seedCheckoutFixture(overrides?: {
  traderCrPrefix?: string;
  traderTaxProfile?: { isVatRegistered: boolean; vatNumber?: string | null; billingLegalName?: string };
}): Promise<CheckoutFixture> {
  const supplier = await prisma.company.create({
    data: {
      crNumber: `CR-CKOSUP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      legalName: "Checkout Supplier",
      accountType: "SUPPLIER",
      verificationStatus: "VERIFIED",
    },
  });
  const trader = await prisma.company.create({
    data: {
      crNumber: `CR-${overrides?.traderCrPrefix ?? "CKOTRD"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      legalName: "Checkout Trader",
      accountType: "TRADER",
      verificationStatus: "VERIFIED",
    },
  });
  await prisma.traderTaxProfile.create({
    data: {
      companyId: trader.id,
      isVatRegistered: overrides?.traderTaxProfile?.isVatRegistered ?? false,
      vatNumber: overrides?.traderTaxProfile?.isVatRegistered ? (overrides?.traderTaxProfile?.vatNumber ?? null) : null,
      billingLegalName: overrides?.traderTaxProfile?.billingLegalName ?? `Test Trader LLC ${trader.id.slice(0, 8)}`,
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
  // A second city inside the SAME region (fulfillment region) —
  // for the SAME_REGION_DIFFERENT_CITY shipping tier.
  const cityElsewhereSameRegion = await prisma.city.create({ data: { regionId: region.id, nameAr: "c2", nameEn: "c2" } });
  // A wholly different region — for the DIFFERENT_REGION shipping tier.
  const farRegion = await prisma.region.create({ data: { nameAr: "r2", nameEn: "r2" } });
  const farCity = await prisma.city.create({ data: { regionId: farRegion.id, nameAr: "c3", nameEn: "c3" } });
  const supplierLocation = await prisma.companyLocation.create({
    data: {
      companyId: supplier.id,
      cityId: city.id,
      name: "supplier-loc",
      shortAddress: "addr",
      latitude: 24.7,
      longitude: 46.6,
      contactName: "n",
      contactPhone: "p",
      isDefault: true,
    },
  });
  const traderLocation = await prisma.companyLocation.create({
    data: {
      companyId: trader.id,
      cityId: city.id,
      name: "trader-loc-same-city",
      shortAddress: "trader addr",
      latitude: 24.8,
      longitude: 46.7,
      contactName: "trader contact",
      contactPhone: "+966500000099",
      isDefault: true,
    },
  });
  const traderLocationSameRegion = await prisma.companyLocation.create({
    data: {
      companyId: trader.id,
      cityId: cityElsewhereSameRegion.id,
      name: "trader-loc-same-region",
      shortAddress: "trader addr 2",
      latitude: 24.9,
      longitude: 46.9,
      contactName: "trader contact 2",
      contactPhone: "+966500000098",
      isDefault: false,
    },
  });
  const traderLocationFarRegion = await prisma.companyLocation.create({
    data: {
      companyId: trader.id,
      cityId: farCity.id,
      name: "trader-loc-far-region",
      shortAddress: "trader addr 3",
      latitude: 25.5,
      longitude: 47.5,
      contactName: "trader contact 3",
      contactPhone: "+966500000097",
      isDefault: false,
    },
  });

  const policyV1 = await prisma.shareTierPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });
  const commissionV1 = await prisma.commissionPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });

  const opportunity = await prisma.opportunity.create({
    data: {
      companyId: supplier.id,
      productId: product.id,
      fulfillmentLocationId: supplierLocation.id,
      fulfillmentCityId: city.id,
      fulfillmentCityNameAr: "c",
      fulfillmentCityNameEn: "c",
      fulfillmentRegionId: region.id,
      fulfillmentRegionNameAr: "r",
      fulfillmentRegionNameEn: "r",
      productApprovalSnapshotId: snapshot.id,
      targetQuantity: 100,
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
      totalValueInclTaxAmount: 1000,
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

  let tariff = await prisma.shippingTariffPolicyVersion.findFirst({ orderBy: { version: "desc" } });
  if (!tariff) {
    tariff = await prisma.shippingTariffPolicyVersion.create({
      data: { sameCityFeeAmount: 10, sameRegionDifferentCityFeeAmount: 20, differentRegionFeeAmount: 30 },
    });
  }

  // Policy acceptance so the trader passes the "latest mandatory
  // policy accepted" checkout gate.
  const mandatoryPolicies = await prisma.policyVersion.findMany({ where: { isPublished: true, isMandatory: true } });
  const traderUser = await prisma.user.create({
    data: {
      companyId: trader.id,
      email: `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
      passwordHash: "x",
      primaryMobile1: "+966500000001",
      primaryMobile2: "+966500000002",
      emailVerificationStatus: "VERIFIED",
    },
  });
  for (const p of mandatoryPolicies) {
    await prisma.policyAcceptance.upsert({
      where: { policyVersionId_userId: { policyVersionId: p.id, userId: traderUser.id } },
      create: { policyVersionId: p.id, companyId: trader.id, userId: traderUser.id, accountTypeSnapshot: "TRADER" },
      update: {},
    });
  }

  return {
    opportunityId: opportunity.id,
    supplierCompanyId: supplier.id,
    traderCompanyId: trader.id,
    traderUserId: traderUser.id,
    traderLocationId: traderLocation.id,
    traderLocations: {
      sameCity: traderLocation.id,
      sameRegionDifferentCity: traderLocationSameRegion.id,
      differentRegion: traderLocationFarRegion.id,
    },
    tariffId: tariff.id,
  };
}

export { prisma as checkoutFixturePrisma };
