import { PrismaClient } from "@prisma/client";
import { uniqueCrNumber, uniqueEmail, uniqueMobile } from "./unique";

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
  /**
   * WHICH OF THE TWO SALES PATHS TO SEED. Defaults to GROUP, which is
   * what every existing caller means and what the platform sold before
   * there were two.
   *
   * A DIRECT listing is the SAME row with the collective arithmetic
   * left out: no window, no share tier, no share quantity — and that
   * is the point of the whole design, so the fixture states it by
   * omission rather than by building a second one.
   */
  saleMode?: "GROUP" | "DIRECT";
  /** The collective target, or the stock on the shelf. */
  targetQuantity?: number;
}): Promise<CheckoutFixture> {
  const saleMode = overrides?.saleMode ?? "GROUP";
  const targetQuantity = overrides?.targetQuantity ?? 100;
  const supplier = await prisma.company.create({
    data: {
      crNumber: uniqueCrNumber("CR-CKOSUP"),
      legalName: "Checkout Supplier",
      accountType: "SUPPLIER",
      verificationStatus: "VERIFIED",
    },
  });
  const trader = await prisma.company.create({
    data: {
      crNumber: uniqueCrNumber(`CR-${overrides?.traderCrPrefix ?? "CKOTRD"}`),
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
  // THE SNAPSHOT CARRIES THE NAMES, because an order now reads them
  // out of it.
  //
  // It was `{}` — harmless while nothing looked inside. Then
  // `20260902070000_order_freezes_what_was_sold` made a master order
  // freeze WHAT was sold beside WHO sold it, and the webhook began
  // reading `nameAr`/`nameEn` from this very JSON to fill two NOT NULL
  // columns. Against an empty object it reads `undefined`, and Prisma
  // refuses the create with «Argument `productNameArSnapshot` is
  // missing» — so no integration test could get an order created.
  //
  // IN PRODUCTION THE NAMES ARE ALWAYS THERE: `buildProductSnapshotPayload`
  // writes them on every approval. This is the fixture catching up with
  // the shape the real one has had all along.
  const snapshot = await prisma.productApprovalSnapshot.create({
    data: {
      productId: product.id,
      approvalSource: "AUTO",
      // AND THE SELLING UNIT, because publishing reads it from here.
      //
      // `computeSnapshotFields` takes the sales unit names EXCLUSIVELY
      // from this frozen JSON — never from a live product join — and
      // refuses outright when it finds neither them nor a legacy
      // `salesUnitId`. Every real snapshot carries them
      // (`buildProductSnapshotPayload` writes them on approval); this
      // is the fixture catching up with the shape the real one has.
      snapshot: {
        nameAr: product.nameAr,
        nameEn: product.nameEn,
        salesUnitNameAr: product.salesUnitNameAr,
        salesUnitNameEn: product.salesUnitNameEn,
      },
    },
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
      regionId: region.id,
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
      regionId: region.id,
      cityId: city.id,
      name: "trader-loc-same-city",
      shortAddress: "trader addr",
      latitude: 24.8,
      longitude: 46.7,
      contactName: "trader contact",
      contactPhone: uniqueMobile(),
      isDefault: true,
    },
  });
  const traderLocationSameRegion = await prisma.companyLocation.create({
    data: {
      companyId: trader.id,
      regionId: region.id,
      cityId: cityElsewhereSameRegion.id,
      name: "trader-loc-same-region",
      shortAddress: "trader addr 2",
      latitude: 24.9,
      longitude: 46.9,
      contactName: "trader contact 2",
      contactPhone: uniqueMobile(),
      isDefault: false,
    },
  });
  const traderLocationFarRegion = await prisma.companyLocation.create({
    data: {
      companyId: trader.id,
      regionId: farRegion.id,
      cityId: farCity.id,
      name: "trader-loc-far-region",
      shortAddress: "trader addr 3",
      latitude: 25.5,
      longitude: 47.5,
      contactName: "trader contact 3",
      contactPhone: uniqueMobile(),
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
      saleMode,
      targetQuantity,
      unitPriceAmount: 10,
      startAt: new Date(Date.now() - 3600_000),
      // A SHELF HAS NO WINDOW. `opportunities_sale_mode_window` refuses
      // a DIRECT row that carries one.
      endAt: saleMode === "DIRECT" ? null : new Date(Date.now() + 5 * 24 * 3600_000),
      expectedPreparationDays: 3,
      status: "ACTIVE",
      firstActivatedAt: new Date(Date.now() - 3600_000),
      taxRatePercent: 15,
      unitPriceExclTaxAmount: 8.7,
      unitTaxAmount: 1.3,
      taxCalculationRuleCode: "DEFAULT",
      taxCalculationRuleVersion: "v1",
      // THE FIVE SHARE COLUMNS MOVE TOGETHER and belong to GROUP alone —
      // `opportunities_share_snapshot_consistency` refuses any of them
      // on a DIRECT row, and refuses a published GROUP row without them.
      ...(saleMode === "DIRECT"
        ? {}
        : {
            totalValueInclTaxAmount: targetQuantity * 10,
            shareTierPolicyVersionId: policyV1.id,
            shareTierIndex: 0,
            shareBasisPoints: 1000,
            shareQuantity: 4,
          }),
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
  // EVERY IDENTITY FROM THE ONE GENERATOR — see `./unique`, which
  // explains why these may never be constants.
  const traderUser = await prisma.user.create({
    data: {
      companyId: trader.id,
      email: uniqueEmail("checkout"),
      passwordHash: "x",
      primaryMobile1: uniqueMobile(),
      primaryMobile2: uniqueMobile(),
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
