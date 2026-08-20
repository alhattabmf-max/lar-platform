import { PrismaClient } from "@prisma/client";

export interface SharedContext {
  companyId: string;
  productId: string;
  fulfillmentLocationId: string;
  cityId: string;
  regionId: string;
  snapshotId: string;
  policyVersionId: string;
  salesUnitId: string;
  commissionPolicyVersionId: string;
  commissionRateBasisPoints: number;
}

export async function buildSharedContext(prisma: PrismaClient): Promise<SharedContext> {
  const company = await prisma.company.create({
    data: {
      crNumber: `CR-WORKER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      legalName: "Worker Test Co",
      accountType: "SUPPLIER",
      verificationStatus: "VERIFIED",
    },
  });
  const node = await prisma.taxonomyNode.create({ data: { nameAr: "a", nameEn: "a" } });
  const unit = await prisma.salesUnit.create({ data: { nameAr: "a", nameEn: "a" } });
  const product = await prisma.product.create({
    data: {
      companyId: company.id,
      taxonomyNodeId: node.id,
      salesUnitId: unit.id,
      salesUnitNameAr: "a",
      salesUnitNameEn: "a",
      nameAr: "p",
      nameEn: "p",
      weightPerUnit: 1,
      lengthCm: 1,
      widthCm: 1,
      heightCm: 1,
    },
  });
  const snapshot = await prisma.productApprovalSnapshot.create({
    data: { productId: product.id, approvalSource: "ADMIN", snapshot: { salesUnitId: unit.id }, approvedByAdminId: crypto.randomUUID() },
  });
  const region = await prisma.region.create({ data: { nameAr: "r", nameEn: "r" } });
  const city = await prisma.city.create({ data: { regionId: region.id, nameAr: "c", nameEn: "c" } });
  const location = await prisma.companyLocation.create({
    data: {
      companyId: company.id,
      cityId: city.id,
      name: "loc",
      shortAddress: "addr",
      latitude: 24.7,
      longitude: 46.6,
      contactName: "n",
      contactPhone: "p",
      isDefault: true,
    },
  });
  const policyV1 = await prisma.shareTierPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });
  const commissionV1 = await prisma.commissionPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });

  return {
    companyId: company.id,
    productId: product.id,
    fulfillmentLocationId: location.id,
    cityId: city.id,
    regionId: region.id,
    snapshotId: snapshot.id,
    policyVersionId: policyV1.id,
    commissionPolicyVersionId: commissionV1.id,
    commissionRateBasisPoints: commissionV1.rateBasisPoints,
    salesUnitId: unit.id,
  };
}

export async function makeEligibleForActivation(prisma: PrismaClient, ctx: SharedContext): Promise<void> {
  await prisma.product.update({ where: { id: ctx.productId }, data: { approvalStatus: "APPROVED" } });

  const bankAccount = await prisma.supplierBankAccount.create({
    data: {
      companyId: ctx.companyId,
      accountHolderName: "Holder",
      bankName: "Test Bank",
      ibanCiphertext: "ciphertext",
      ibanFingerprint: `fp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ibanLast4: "1234",
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
    },
  });
  await prisma.company.update({
    where: { id: ctx.companyId },
    data: { activeBankAccountId: bankAccount.id },
  });
  await prisma.supplierTaxProfile.create({
    data: { companyId: ctx.companyId, isVatRegistered: false },
  });
  await prisma.supplierInvoicingProfile.create({
    data: { companyId: ctx.companyId, invoicingLegalName: "Worker Test Co LLC" },
  });
}

export async function seedOpportunity(
  prisma: PrismaClient,
  ctx: SharedContext,
  overrides: {
    status: "ACTIVE" | "PAUSED" | "SCHEDULED";
    targetQuantity: number;
    fundedQuantity: number;
    startAt: Date;
    endAt: Date;
    firstActivatedAt?: Date | null;
  }
): Promise<string> {
  const isFirstActivated = overrides.status !== "SCHEDULED";
  const opp = await prisma.opportunity.create({
    data: {
      companyId: ctx.companyId,
      productId: ctx.productId,
      fulfillmentLocationId: ctx.fulfillmentLocationId,
      fulfillmentCityId: ctx.cityId,
      fulfillmentCityNameAr: "c",
      fulfillmentCityNameEn: "c",
      fulfillmentRegionId: ctx.regionId,
      fulfillmentRegionNameAr: "r",
      fulfillmentRegionNameEn: "r",
      productApprovalSnapshotId: ctx.snapshotId,
      targetQuantity: overrides.targetQuantity,
      fundedQuantity: overrides.fundedQuantity,
      unitPriceAmount: 10,
      startAt: overrides.startAt,
      endAt: overrides.endAt,
      expectedPreparationDays: 3,
      status: overrides.status,
      firstActivatedAt:
        overrides.firstActivatedAt !== undefined
          ? overrides.firstActivatedAt
          : isFirstActivated
            ? overrides.startAt
            : null,
      pausedAt: overrides.status === "PAUSED" ? new Date(Date.now() - 1800_000) : null,
      pauseReason: overrides.status === "PAUSED" ? "test hold" : null,
      taxRatePercent: 15,
      unitPriceExclTaxAmount: 8.7,
      unitTaxAmount: 1.3,
      taxCalculationRuleCode: "DEFAULT",
      taxCalculationRuleVersion: "v1",
      totalValueInclTaxAmount: overrides.targetQuantity * 10,
      shareTierPolicyVersionId: ctx.policyVersionId,
      shareTierIndex: 0,
      shareBasisPoints: 1000,
      shareQuantity: Math.max(1, Math.floor((overrides.targetQuantity * 1000) / 10000)),
      salesUnitNameAr: "a",
      salesUnitNameEn: "a",
      commissionPolicyVersionId: ctx.commissionPolicyVersionId,
      commissionRateBasisPoints: ctx.commissionRateBasisPoints,
    },
  });
  return opp.id;
}
