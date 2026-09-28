import { PrismaClient } from "@prisma/client";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { seedFulfillmentFixture } from "./fixtures/fulfillment.fixture";

const prisma = checkoutFixturePrisma;

async function seedLockedSession(overrides?: Partial<{ lockCreatedAt: Date; lockExpiresAt: Date }>) {
  const fixture = await seedCheckoutFixture({ traderCrPrefix: "CONSTR" });
  const session = await prisma.checkoutSession.create({
    data: {
      opportunityId: fixture.opportunityId,
      traderCompanyId: fixture.traderCompanyId,
      lockedQuantity: 4,
      lockCreatedAt: overrides?.lockCreatedAt ?? new Date(),
      lockExpiresAt: overrides?.lockExpiresAt ?? new Date(Date.now() + 15 * 60_000),
      traderCompanySnapshot: {},
    },
  });
  return { fixture, session };
}

describe("Checkout DB constraints — direct breakage proof (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  describe("checkout_sessions_status_release_consistency", () => {
    it("rejects LOCKED with a non-NULL releaseReason", async () => {
      const { fixture } = await seedLockedSession();
      await expect(
        prisma.$executeRaw`
          INSERT INTO checkout_sessions (id, opportunity_id, trader_company_id, status, locked_quantity, lock_created_at, lock_expires_at, release_reason, trader_company_snapshot, updated_at)
          VALUES (gen_random_uuid(), ${fixture.opportunityId}::uuid, ${fixture.traderCompanyId}::uuid, 'LOCKED', 4, now(), now() + interval '15 minutes', 'EXPIRED', '{}', now())
        `
      ).rejects.toThrow(/checkout_sessions_status_release_consistency/);
    });

    it("rejects EXPIRED with a NULL lockReleasedAt", async () => {
      const { fixture } = await seedLockedSession();
      await expect(
        prisma.$executeRaw`
          INSERT INTO checkout_sessions (id, opportunity_id, trader_company_id, status, locked_quantity, lock_created_at, lock_expires_at, release_reason, trader_company_snapshot, updated_at)
          VALUES (gen_random_uuid(), ${fixture.opportunityId}::uuid, ${fixture.traderCompanyId}::uuid, 'EXPIRED', 4, now(), now() + interval '15 minutes', 'EXPIRED', '{}', now())
        `
      ).rejects.toThrow(/checkout_sessions_status_release_consistency/);
    });

    it("rejects EXPIRED with releaseReason other than EXPIRED", async () => {
      const { fixture } = await seedLockedSession();
      await expect(
        prisma.$executeRaw`
          INSERT INTO checkout_sessions (id, opportunity_id, trader_company_id, status, locked_quantity, lock_created_at, lock_expires_at, lock_released_at, release_reason, trader_company_snapshot, updated_at)
          VALUES (gen_random_uuid(), ${fixture.opportunityId}::uuid, ${fixture.traderCompanyId}::uuid, 'EXPIRED', 4, now(), now() + interval '15 minutes', now(), 'TRADER_ABANDONED', '{}', now())
        `
      ).rejects.toThrow(/checkout_sessions_status_release_consistency/);
    });

    it("rejects ABANDONED with a NULL releaseReason", async () => {
      const { fixture } = await seedLockedSession();
      await expect(
        prisma.$executeRaw`
          INSERT INTO checkout_sessions (id, opportunity_id, trader_company_id, status, locked_quantity, lock_created_at, lock_expires_at, lock_released_at, trader_company_snapshot, updated_at)
          VALUES (gen_random_uuid(), ${fixture.opportunityId}::uuid, ${fixture.traderCompanyId}::uuid, 'ABANDONED', 4, now(), now() + interval '15 minutes', now(), '{}', now())
        `
      ).rejects.toThrow(/checkout_sessions_status_release_consistency/);
    });

    it("accepts a correctly-consistent ABANDONED row (control case)", async () => {
      const { fixture } = await seedLockedSession();
      await expect(
        prisma.$executeRaw`
          INSERT INTO checkout_sessions (id, opportunity_id, trader_company_id, status, locked_quantity, lock_created_at, lock_expires_at, lock_released_at, release_reason, trader_company_snapshot, updated_at)
          VALUES (gen_random_uuid(), ${fixture.opportunityId}::uuid, ${fixture.traderCompanyId}::uuid, 'ABANDONED', 4, now(), now() + interval '15 minutes', now(), 'TRADER_ABANDONED', '{}', now())
        `
      ).resolves.toBeDefined();
    });
  });

  describe("checkout_sessions_lock_expires_after_created", () => {
    it("rejects lockExpiresAt <= lockCreatedAt", async () => {
      const { fixture } = await seedLockedSession();
      const t = new Date();
      await expect(
        prisma.$executeRaw`
          INSERT INTO checkout_sessions (id, opportunity_id, trader_company_id, status, locked_quantity, lock_created_at, lock_expires_at, trader_company_snapshot, updated_at)
          VALUES (gen_random_uuid(), ${fixture.opportunityId}::uuid, ${fixture.traderCompanyId}::uuid, 'LOCKED', 4, ${t}, ${t}, '{}', now())
        `
      ).rejects.toThrow(/checkout_sessions_lock_expires_after_created/);
    });
  });

  describe("checkout_location_allocations DEFERRABLE CONSTRAINT TRIGGER — quantity sum", () => {
    it("succeeds at INSERT time but fails exactly at COMMIT when sum(quantity) != lockedQuantity", async () => {
      const { fixture, session } = await seedLockedSession();
      await prisma.quoteSnapshot.create({
        data: {
          checkoutSessionId: session.id,
          productApprovalSnapshotId: (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } }))
            .productApprovalSnapshotId!,
          salesUnitNameAr: "a",
          salesUnitNameEn: "a",
          quantity: 4,
          shareQuantity: 4,
          sharePercentageReadable: 10,
          unitPriceInclTaxAmount: 10,
          unitPriceExclTaxAmount: 8.7,
          unitTaxAmount: 1.3,
          taxRatePercent: 15,
          taxCalculationRuleCode: "D",
          taxCalculationRuleVersion: "v1",
          productsSubtotalExclTaxAmount: 34.8,
          productsTaxAmount: 5.2,
          productsSubtotalInclTaxAmount: 40,
          totalShippingFeeAmount: 10,
          grandTotalAmount: 50,
          shippingTariffPolicyVersionId: fixture.tariffId,
          shippingProviderCode: "ADMIN_TARIFF_V1",
        },
      });

      // PROOF (Point 1): Prisma's $transaction() does NOT reliably
      // surface this deferred trigger's exception by default —
      // confirmed directly via a raw diagnostic: Prisma logs
      // "transaction failed to commit" internally, yet still resolves
      // the Promise as success. We assert that exact behavior here
      // explicitly, rather than silently working around it.
      const outcome = await prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO checkout_location_allocations (id, checkout_session_id, company_location_id, location_name_snapshot, city_name_ar_snapshot, city_name_en_snapshot, region_name_ar_snapshot, region_name_en_snapshot, address_snapshot, contact_name_snapshot, contact_phone_snapshot, quantity, shipping_tier_code, shipping_fee_amount)
            VALUES (gen_random_uuid(), ${session.id}::uuid, ${fixture.traderLocations.sameCity}::uuid, 'l', 'c', 'c', 'r', 'r', 'a', 'n', 'p', 2, 'SAME_CITY', 10)
          `;
          return "resolved" as const;
        })
        .catch(() => "rejected" as const);
      expect(outcome).toBe("resolved"); // documents Prisma's actual (surprising) default behavior

      // But the data is genuinely NEVER persisted regardless — Postgres
      // itself rolled the transaction back correctly.
      const persistedWithoutImmediate = await prisma.checkoutLocationAllocation.count({ where: { checkoutSessionId: session.id } });
      expect(persistedWithoutImmediate).toBe(0);

      // PROOF (Point 2/4): adding the exact SET CONSTRAINTS ... IMMEDIATE
      // call CheckoutSessionService itself now uses makes the SAME
      // trigger throw a REAL, catchable exception with its real message —
      // this is not a theoretical fix, it is proven here directly.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO checkout_location_allocations (id, checkout_session_id, company_location_id, location_name_snapshot, city_name_ar_snapshot, city_name_en_snapshot, region_name_ar_snapshot, region_name_en_snapshot, address_snapshot, contact_name_snapshot, contact_phone_snapshot, quantity, shipping_tier_code, shipping_fee_amount)
            VALUES (gen_random_uuid(), ${session.id}::uuid, ${fixture.traderLocations.sameCity}::uuid, 'l', 'c', 'c', 'r', 'r', 'a', 'n', 'p', 2, 'SAME_CITY', 10)
          `;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_checkout_allocation_totals IMMEDIATE`);
        })
      ).rejects.toThrow(/does not match checkout_sessions.locked_quantity/);

      const persistedWithImmediate = await prisma.checkoutLocationAllocation.count({ where: { checkoutSessionId: session.id } });
      expect(persistedWithImmediate).toBe(0);
    }, 15_000);
  });

  describe("checkout_location_allocations DEFERRABLE CONSTRAINT TRIGGER — shipping fee sum", () => {
    it("SET CONSTRAINTS ... IMMEDIATE (the exact mechanism used by CheckoutSessionService) makes the shipping-fee mismatch throw a real, catchable exception", async () => {
      const { fixture, session } = await seedLockedSession();
      await prisma.quoteSnapshot.create({
        data: {
          checkoutSessionId: session.id,
          productApprovalSnapshotId: (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } }))
            .productApprovalSnapshotId!,
          salesUnitNameAr: "a",
          salesUnitNameEn: "a",
          quantity: 4,
          shareQuantity: 4,
          sharePercentageReadable: 10,
          unitPriceInclTaxAmount: 10,
          unitPriceExclTaxAmount: 8.7,
          unitTaxAmount: 1.3,
          taxRatePercent: 15,
          taxCalculationRuleCode: "D",
          taxCalculationRuleVersion: "v1",
          productsSubtotalExclTaxAmount: 34.8,
          productsTaxAmount: 5.2,
          productsSubtotalInclTaxAmount: 40,
          totalShippingFeeAmount: 10,
          grandTotalAmount: 50,
          shippingTariffPolicyVersionId: fixture.tariffId,
          shippingProviderCode: "ADMIN_TARIFF_V1",
        },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO checkout_location_allocations (id, checkout_session_id, company_location_id, location_name_snapshot, city_name_ar_snapshot, city_name_en_snapshot, region_name_ar_snapshot, region_name_en_snapshot, address_snapshot, contact_name_snapshot, contact_phone_snapshot, quantity, shipping_tier_code, shipping_fee_amount)
            VALUES (gen_random_uuid(), ${session.id}::uuid, ${fixture.traderLocations.sameCity}::uuid, 'l', 'c', 'c', 'r', 'r', 'a', 'n', 'p', 4, 'SAME_CITY', 999)
          `;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_checkout_allocation_totals IMMEDIATE`);
        })
      ).rejects.toThrow(/does not match quote_snapshots.total_shipping_fee_amount/);

      const persisted = await prisma.checkoutLocationAllocation.count({ where: { checkoutSessionId: session.id } });
      expect(persisted).toBe(0);
    }, 15_000);
  });

  describe("quote_snapshots financial equation CHECKs", () => {
    async function baseQuoteData(sessionId: string, snapshotId: string, tariffId: string) {
      return {
        checkoutSessionId: sessionId,
        productApprovalSnapshotId: snapshotId,
        salesUnitNameAr: "a",
        salesUnitNameEn: "a",
        quantity: 4,
        shareQuantity: 4,
        sharePercentageReadable: 10,
        unitPriceInclTaxAmount: 10,
        unitPriceExclTaxAmount: 8.7,
        unitTaxAmount: 1.3,
        taxRatePercent: 15,
        taxCalculationRuleCode: "D",
        taxCalculationRuleVersion: "v1",
        shippingTariffPolicyVersionId: tariffId,
        shippingProviderCode: "ADMIN_TARIFF_V1",
      };
    }

    it("rejects productsSubtotalExcl + productsTax != productsSubtotalIncl", async () => {
      const { fixture, session } = await seedLockedSession();
      const snapshotId = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).productApprovalSnapshotId!;
      const base = await baseQuoteData(session.id, snapshotId, fixture.tariffId);
      await expect(
        prisma.quoteSnapshot.create({
          data: {
            ...base,
            productsSubtotalExclTaxAmount: 34.8,
            productsTaxAmount: 5.2,
            productsSubtotalInclTaxAmount: 999,
            totalShippingFeeAmount: 10,
            grandTotalAmount: 1009,
          },
        })
      ).rejects.toThrow(/quote_snapshots_products_subtotal_equation|CHECK/);
    });

    it("rejects grandTotal != productsSubtotalIncl + totalShippingFee", async () => {
      const { fixture, session } = await seedLockedSession();
      const snapshotId = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).productApprovalSnapshotId!;
      const base = await baseQuoteData(session.id, snapshotId, fixture.tariffId);
      await expect(
        prisma.quoteSnapshot.create({
          data: {
            ...base,
            productsSubtotalExclTaxAmount: 34.8,
            productsTaxAmount: 5.2,
            productsSubtotalInclTaxAmount: 40,
            totalShippingFeeAmount: 10,
            grandTotalAmount: 999,
          },
        })
      ).rejects.toThrow(/quote_snapshots_grand_total_equation|CHECK/);
    });

    it("accepts a fully-consistent quote (control case)", async () => {
      const { fixture, session } = await seedLockedSession();
      const snapshotId = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).productApprovalSnapshotId!;
      const base = await baseQuoteData(session.id, snapshotId, fixture.tariffId);
      await expect(
        prisma.quoteSnapshot.create({
          data: {
            ...base,
            productsSubtotalExclTaxAmount: 34.8,
            productsTaxAmount: 5.2,
            productsSubtotalInclTaxAmount: 40,
            totalShippingFeeAmount: 10,
            grandTotalAmount: 50,
          },
        })
      ).resolves.toBeDefined();
    });


    it("QuoteSnapshot rows can never be UPDATEd", async () => {
      const { fixture, session } = await seedLockedSession();
      const snapshotId = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).productApprovalSnapshotId!;
      const base = await baseQuoteData(session.id, snapshotId, fixture.tariffId);
      const quote = await prisma.quoteSnapshot.create({
        data: {
          ...base,
          productsSubtotalExclTaxAmount: 34.8,
          productsTaxAmount: 5.2,
          productsSubtotalInclTaxAmount: 40,
          totalShippingFeeAmount: 10,
          grandTotalAmount: 50,
        },
      });

      await expect(prisma.$executeRaw`UPDATE quote_snapshots SET quantity = 999 WHERE id = ${quote.id}::uuid`).rejects.toThrow(
        /append-only|immutable/
      );
    });

    // DELETE IS NOT THE SAME RULE AS UPDATE, and this test used to claim
    // it was: it asserted that deleting a quote raised «append-only»,
    // which the trigger has not done since
    // `20260902060100_allocation_deletable_when_unpaid`.
    //
    // That migration made an abandoned checkout removable. A quote is
    // the price the trader was SHOWN; while nothing was bought on it,
    // it is a discarded draft and deleting the session takes it with
    // it. The moment an order is built on that session the same quote
    // becomes the record of what was sold, and the trigger refuses.
    //
    // The old assertion passed only because no order existed — so it
    // was asserting the opposite of what it said, and would have gone
    // on passing if the protection that matters had been removed.
    it("a QuoteSnapshot CAN be DELETEd while no order was built on its session", async () => {
      const { fixture, session } = await seedLockedSession();
      const snapshotId = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).productApprovalSnapshotId!;
      const base = await baseQuoteData(session.id, snapshotId, fixture.tariffId);
      const quote = await prisma.quoteSnapshot.create({
        data: {
          ...base,
          productsSubtotalExclTaxAmount: 34.8,
          productsTaxAmount: 5.2,
          productsSubtotalInclTaxAmount: 40,
          totalShippingFeeAmount: 10,
          grandTotalAmount: 50,
        },
      });

      const orders = await prisma.masterOrder.count({ where: { checkoutSessionId: session.id } });
      expect(orders).toBe(0);

      await expect(prisma.$executeRaw`DELETE FROM quote_snapshots WHERE id = ${quote.id}::uuid`).resolves.toBe(1);
      expect(await prisma.quoteSnapshot.findUnique({ where: { id: quote.id } })).toBeNull();
    });

    it("a QuoteSnapshot CANNOT be DELETEd once an order was built on its session", async () => {
      // The branch that guards money: this quote is what the buyer was
      // charged, and the order points back at it.
      const paid = await seedFulfillmentFixture("QUOTEDEL");
      const order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: paid.masterOrderId } });
      const quote = await prisma.quoteSnapshot.findFirstOrThrow({ where: { checkoutSessionId: order.checkoutSessionId } });

      await expect(prisma.$executeRaw`DELETE FROM quote_snapshots WHERE id = ${quote.id}::uuid`).rejects.toThrow(
        /cannot delete a quote an order was built on/
      );
      expect(await prisma.quoteSnapshot.findUnique({ where: { id: quote.id } })).not.toBeNull();
    }, 60_000);
  });
});
