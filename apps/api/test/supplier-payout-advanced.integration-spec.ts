import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { SupplierPayoutService } from "../src/settlement/supplier-payout.service";
import { DisputeService } from "../src/disputes/dispute.service";
import { seedSettlementFixture, settlementFixturePrisma } from "./fixtures/settlement.fixture";

const prisma = settlementFixturePrisma;

function buildPayoutService(p: PrismaService = prisma as unknown as PrismaService) {
  return new SupplierPayoutService(p);
}
const adminCtx = () => ({ userId: crypto.randomUUID(), requestId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
const idemKey = (prefix: string) => `settle:${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

describe("SupplierPayoutService — advanced (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("two concurrent settlement attempts on the SAME allocation via two separate connections: exactly one succeeds", async () => {
    const fixture = await seedSettlementFixture("PAYOUTCONCURRENT");
    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();
    const serviceA = buildPayoutService(prismaA as unknown as PrismaService);
    const serviceB = buildPayoutService(prismaB as unknown as PrismaService);

    const results = await Promise.allSettled([
      serviceA.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: `REF-CONCA-${Date.now()}` }, adminCtx(), idemKey("conca")),
      serviceB.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: `REF-CONCB-${Date.now()}` }, adminCtx(), idemKey("concb")),
    ]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded).toHaveLength(1);

    const payoutCount = await prisma.supplierPayout.count({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    expect(payoutCount).toBe(1);
  }, 30_000);

  it("REAL race: DisputeService.openDispute vs SupplierPayoutService.settle on the same allocation via two separate connections — proves BOTH correct outcomes, never asserting which wins", async () => {
    const fixture = await seedSettlementFixture("PAYOUTRACE", 5_000);
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r-race-dispute" };

    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();
    const disputeService = new DisputeService(prismaA as unknown as PrismaService);
    const payoutService = buildPayoutService(prismaB as unknown as PrismaService);

    const results = await Promise.allSettled([
      disputeService.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Racing against a real settlement attempt." }, traderCtx),
      payoutService.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: `REF-RACE-${Date.now()}` }, adminCtx(), idemKey("race")),
    ]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    const [disputeResult, settleResult] = results;
    const finalAllocation = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: fixture.deliveredOrderAllocationId } });
    const finalDispute = await prisma.dispute.findUnique({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });

    if (disputeResult.status === "fulfilled") {
      expect(finalDispute).not.toBeNull();
      expect(finalAllocation.payoutSettledAt).toBeNull();
      expect(settleResult.status).toBe("rejected");
    } else {
      expect(finalAllocation.payoutSettledAt).not.toBeNull();
      expect(finalDispute).toBeNull();
      expect(settleResult.status).toBe("fulfilled");
    }
  }, 30_000);

  it("Idempotency: replaying the exact same settlement request with the same key returns the SAME SupplierPayout, no second row", async () => {
    const fixture = await seedSettlementFixture("PAYOUTIDEMPOTENT");
    const service = buildPayoutService();
    const key = idemKey("idem");
    const ref = `REF-IDEM-${Date.now()}`;

    const first = await service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: ref }, adminCtx(), key);
    const second = await service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: ref }, adminCtx(), key);

    expect(second.supplierPayoutId).toBe(first.supplierPayoutId);
    const payoutCount = await prisma.supplierPayout.count({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    expect(payoutCount).toBe(1);
  }, 30_000);

  it("Idempotency: the same key with a DIFFERENT payload (different externalTransferReference) is rejected with a conflict", async () => {
    const fixture = await seedSettlementFixture("PAYOUTIDEMPOTENTCONFLICT");
    const service = buildPayoutService();
    const key = idemKey("idemconflict");

    await service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: `REF-A-${Date.now()}` }, adminCtx(), key);
    await expect(
      service.settle(fixture.deliveredOrderAllocationId, { externalTransferReference: `REF-B-${Date.now()}` }, adminCtx(), key)
    ).rejects.toThrow();
  }, 30_000);

  it("DB: an unbalanced settlement journal is rejected at SET CONSTRAINTS IMMEDIATE", async () => {
    const fixture = await seedSettlementFixture("PAYOUTUNBALANCED");
    const masterOrder = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });

    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          const payout = await tx.supplierPayout.create({
            data: {
              orderAllocationId: fixture.deliveredOrderAllocationId,
              outcome: "EXECUTED",
              externalTransferReference: `REF-UNBAL-${Date.now()}`,
              netAmount: 100,
              supplierBankAccountId: masterOrder.supplierBankAccountId,
              executedByAdminUserId: crypto.randomUUID(),
            },
          });
          const journal = await tx.journalEntry.create({
            data: { eventType: "SUPPLIER_SETTLEMENT", referenceType: "supplier_payout", referenceId: payout.id, idempotencyKey: `test-unbal-${Date.now()}` },
          });
          await tx.ledgerPosting.createMany({
            data: [
              { journalEntryId: journal.id, account: "SUPPLIER_PAYABLE", direction: "DEBIT", amount: 100 },
              { journalEntryId: journal.id, account: "CASH_CLEARING", direction: "CREDIT", amount: 99 },
            ],
          });
          await tx.$executeRaw`UPDATE order_allocations SET payout_settled_at = now() WHERE id = ${fixture.deliveredOrderAllocationId}::uuid`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/unbalanced/);
  }, 15_000);

  it("DB: a bank account that does NOT match the frozen MasterOrder.supplierBankAccountId is rejected directly", async () => {
    const fixture = await seedSettlementFixture("PAYOUTWRONGBANK");
    const wrongBankAccount = await prisma.supplierBankAccount.create({
      data: {
        companyId: fixture.supplierCompanyId,
        accountHolderName: "Wrong Holder",
        bankName: "Wrong Bank",
        ibanCiphertext: "cipher",
        ibanFingerprint: `fp-wrong-${Date.now()}`,
        ibanLast4: "1111",
        verificationStatus: "VERIFIED",
      },
    });

    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.supplierPayout.create({
            data: {
              orderAllocationId: fixture.deliveredOrderAllocationId,
              outcome: "ZERO_BALANCE",
              netAmount: 0,
              supplierBankAccountId: wrongBankAccount.id,
              executedByAdminUserId: crypto.randomUUID(),
            },
          });
          await tx.$executeRaw`UPDATE order_allocations SET payout_settled_at = now() WHERE id = ${fixture.deliveredOrderAllocationId}::uuid`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_supplier_payout_bank_account_frozen IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/does not match the frozen/);
  }, 15_000);

  it("DB: ZERO_BALANCE with a settlement journal attached is rejected", async () => {
    const fixture = await seedSettlementFixture("PAYOUTZEROBALJOURNAL");
    const masterOrder = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });

    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          const payout = await tx.supplierPayout.create({
            data: {
              orderAllocationId: fixture.deliveredOrderAllocationId,
              outcome: "ZERO_BALANCE",
              netAmount: 0,
              supplierBankAccountId: masterOrder.supplierBankAccountId,
              executedByAdminUserId: crypto.randomUUID(),
            },
          });
          const journal = await tx.journalEntry.create({
            data: { eventType: "SUPPLIER_SETTLEMENT", referenceType: "supplier_payout", referenceId: payout.id, idempotencyKey: `test-zerojournal-${Date.now()}` },
          });
          await tx.ledgerPosting.createMany({
            data: [
              { journalEntryId: journal.id, account: "SUPPLIER_PAYABLE", direction: "DEBIT", amount: 1 },
              { journalEntryId: journal.id, account: "CASH_CLEARING", direction: "CREDIT", amount: 1 },
            ],
          });
          await tx.$executeRaw`UPDATE order_allocations SET payout_settled_at = now() WHERE id = ${fixture.deliveredOrderAllocationId}::uuid`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_supplier_payout_journal_consistency IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/ZERO_BALANCE outcome must have NO settlement journal entry/);
  }, 15_000);

  it("DB: ZERO_BALANCE with a non-null externalTransferReference is rejected by the row-level CHECK", async () => {
    const fixture = await seedSettlementFixture("PAYOUTZEROBALREF");
    const masterOrder = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });

    await expect(
      prisma.supplierPayout.create({
        data: {
          orderAllocationId: fixture.deliveredOrderAllocationId,
          outcome: "ZERO_BALANCE",
          externalTransferReference: "SHOULD-NOT-EXIST",
          netAmount: 0,
          supplierBankAccountId: masterOrder.supplierBankAccountId,
          executedByAdminUserId: crypto.randomUUID(),
        },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("DB: EXECUTED with a NULL externalTransferReference is rejected by the row-level CHECK", async () => {
    const fixture = await seedSettlementFixture("PAYOUTEXECNOREF");
    const masterOrder = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });

    await expect(
      prisma.supplierPayout.create({
        data: {
          orderAllocationId: fixture.deliveredOrderAllocationId,
          outcome: "EXECUTED",
          externalTransferReference: null,
          netAmount: 100,
          supplierBankAccountId: masterOrder.supplierBankAccountId,
          executedByAdminUserId: crypto.randomUUID(),
        },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("DB: EXECUTED without any settlement journal is rejected at deferred COMMIT", async () => {
    const fixture = await seedSettlementFixture("PAYOUTEXECNOJOURNAL");
    const masterOrder = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });

    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.supplierPayout.create({
            data: {
              orderAllocationId: fixture.deliveredOrderAllocationId,
              outcome: "EXECUTED",
              externalTransferReference: `REF-NOJOURNAL-${Date.now()}`,
              netAmount: 100,
              supplierBankAccountId: masterOrder.supplierBankAccountId,
              executedByAdminUserId: crypto.randomUUID(),
            },
          });
          await tx.$executeRaw`UPDATE order_allocations SET payout_settled_at = now() WHERE id = ${fixture.deliveredOrderAllocationId}::uuid`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_supplier_payout_journal_consistency IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/EXECUTED outcome requires exactly one settlement journal entry/);
  }, 15_000);
});
