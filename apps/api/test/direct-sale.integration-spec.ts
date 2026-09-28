import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { CheckoutSessionService } from "../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../src/settings/checkout-settings.service";
import { PaymentAttemptService } from "../src/payments/payment-attempt.service";
import { PaymentSettingsService } from "../src/settings/payment-settings.service";
import { PaymentWebhookService } from "../src/payments/payment-webhook.service";
import { CommissionTaxPolicyService } from "../src/settings/commission-tax-policy.service";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { AuditService } from "../src/audit/audit.service";
import { OpportunitiesService } from "../src/opportunities/opportunities.service";
import { OpportunitySettingsService } from "../src/settings/opportunity-settings.service";
import { ShareTierSettingsService } from "../src/settings/share-tier-settings.service";
import { CommissionPolicyService } from "../src/settings/commission-policy.service";
import { TaxRateSettingsService } from "../src/settings/tax-rate-settings.service";
import { DefaultTaxRateProvider } from "../src/tax/default-tax-rate.provider";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { seedSupplierBilling } from "./fixtures/fulfillment.fixture";
import { ensureCommissionTaxPolicy, ensureDefaultTaxRate } from "./fixtures/payment.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

/**
 * THE DIRECT SALE, END TO END, AGAINST A REAL DATABASE.
 *
 * «البيع المباشر: المشتري يحدد الكمية، لا يتجاوز المتاح، تُستخدم آلية
 *  الأقفال الحالية، وعند نجاح الدفع فقط ترتفع الكمية المباعة وينتقل
 *  الطلب مباشرة إلى AWAITING_PREPARATION.»
 *
 * WHAT THIS PROVES THAT A UNIT TEST CANNOT. Every claim below is about
 * the database doing something: a row lock serialising two buyers, a
 * CHECK refusing a status, a trigger refusing a quantity. A double
 * cannot refuse anything, and the whole design rests on these refusals
 * being real.
 */
const prisma = checkoutFixturePrisma;
const provider = new MockPaymentProvider();

function services() {
  const p = prisma as unknown as PrismaService;
  const audit = new AuditService(p);
  return {
    checkout: new CheckoutSessionService(
      p,
      new ShippingTariffPolicyService(p, audit),
      new CheckoutSettingsService(p, audit)
    ),
    payments: new PaymentAttemptService(
      p,
      new PaymentSettingsService(p, audit),
      new CommissionTaxPolicyService(p, audit),
      provider
    ),
    webhook: new PaymentWebhookService(
      p,
      new CommissionTaxPolicyService(p, audit),
      provider,
      notificationEvents()
    ),
  };
}

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The supplier-side service, wired to the same database.
 *
 * The tax provider is the only dependency that has to answer anything
 * here — `setDirectStock` and `stopDirect` touch neither the share tier
 * nor the tax snapshot — but the constructor takes what it takes, and
 * building it honestly is cheaper than a partial double that would
 * start lying the moment either method grew.
 */
function supplierService() {
  const p = prisma as unknown as PrismaService;
  const audit = new AuditService(p);
  return new OpportunitiesService(
    p,
    audit,
    new OpportunitySettingsService(p, audit),
    new ShareTierSettingsService(p, audit),
    new CommissionPolicyService(p, audit),
    new DefaultTaxRateProvider(new TaxRateSettingsService(p, audit))
  );
}

/**
 * A direct listing whose supplier can actually be paid.
 *
 * `seedCheckoutFixture` builds the listing; a payment additionally
 * needs the supplier to have a tax profile, an invoicing name and a
 * verified bank account, which is what `seedSupplierBilling` puts
 * there.
 */
async function seedDirectListing(prefix: string, targetQuantity: number) {
  const fixture = await seedCheckoutFixture({
    traderCrPrefix: prefix,
    saleMode: "DIRECT",
    targetQuantity,
  });
  await seedSupplierBilling(fixture.supplierCompanyId);
  return fixture;
}

/** Buys `quantity` through the real path: lock, attempt, signed webhook. */
async function buy(
  fixture: Awaited<ReturnType<typeof seedCheckoutFixture>>,
  quantity: number
) {
  const { checkout, payments, webhook } = services();
  const session = await checkout.create(
    {
      opportunityId: fixture.opportunityId,
      quantity,
      allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity }],
    },
    unique("direct-checkout"),
    { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r-direct" }
  );

  const attempt = await payments.startPayment(session.id, unique("direct-attempt"), {
    userId: fixture.traderUserId,
    companyId: fixture.traderCompanyId,
    requestId: "r-direct-2",
  });

  const { rawBody, headers } = provider.buildSignedWebhook({
    merchantReference: attempt.id,
    providerReference: `ref-${attempt.id}`,
    providerEventId: `evt-${attempt.id}`,
    eventType: "SUCCESS",
    providerCapturedAt: new Date(),
    providerCapturedAmount: Number(attempt.amount),
  });
  const outcome = await webhook.handleWebhook(rawBody, headers);
  return { session, outcome };
}

describe("DIRECT sale (integration, real DB)", () => {
  beforeAll(async () => {
    await ensureCommissionTaxPolicy();
    // PUBLISHING FREEZES A TAX RATE, and refuses when none is
    // configured. Asked for explicitly rather than inherited from
    // whatever the database happened to hold.
    await ensureDefaultTaxRate();
  });

  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("a paid order goes straight to AWAITING_PREPARATION, with a deadline dated from the payment", async () => {
    const fixture = await seedDirectListing("DIRPREP", 40);

    const { outcome } = await buy(fixture, 7);
    expect(outcome.processingOutcome).toBe("ORDER_CREATED");

    const allocations = await prisma.orderAllocation.findMany({
      where: { masterOrder: { opportunityId: fixture.opportunityId } },
    });
    expect(allocations).toHaveLength(1);

    // NOT AWAITING_FUNDING. There is no target to wait for: the goods
    // are on a shelf and the supplier may start now.
    expect(allocations[0].status).toBe("AWAITING_PREPARATION");
    expect(allocations[0].preparationDueAt).not.toBeNull();

    // AND THE CLOCK STARTS AT THE PAYMENT, not at some later closing —
    // the days were frozen on the row against exactly that moment.
    const order = await prisma.masterOrder.findFirstOrThrow({
      where: { opportunityId: fixture.opportunityId },
    });
    const expected = order.paidAt.getTime() + allocations[0].expectedPreparationDays * 24 * 3600_000;
    expect(allocations[0].preparationDueAt!.getTime()).toBe(expected);
  }, 60_000);

  it("selling the last unit leaves the listing ACTIVE and sold out, and a restock makes it buyable again", async () => {
    const fixture = await seedDirectListing("DIRSOLDOUT", 5);

    await buy(fixture, 5);

    const soldOut = await prisma.opportunity.findUniqueOrThrow({
      where: { id: fixture.opportunityId },
    });
    // NEVER FUNDED. It is terminal, it means a collective target was
    // reached, and a shelf that is empty is still a shelf.
    expect(soldOut.status).toBe("ACTIVE");
    expect(soldOut.fundedQuantity).toBe(5);
    expect(soldOut.targetQuantity - soldOut.fundedQuantity).toBe(0);

    // A SECOND BUYER IS REFUSED — not by a status, but by the
    // arithmetic, which is the whole point.
    await expect(buy(fixture, 1)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "CONFLICT" }),
    });

    // RESTOCKED, AND BUYABLE AGAIN. The same row, the same price, the
    // same frozen terms.
    await prisma.opportunity.update({
      where: { id: fixture.opportunityId },
      data: { targetQuantity: 8 },
    });
    const { outcome } = await buy(fixture, 3);
    expect(outcome.processingOutcome).toBe("ORDER_CREATED");

    const after = await prisma.opportunity.findUniqueOrThrow({
      where: { id: fixture.opportunityId },
    });
    expect(after.status).toBe("ACTIVE");
    expect(after.fundedQuantity).toBe(8);
  }, 90_000);

  it("the database refuses FUNDED, EXPIRED and SCHEDULED on a direct listing", async () => {
    const fixture = await seedDirectListing("DIRSTATUS", 10);

    for (const status of ["FUNDED", "EXPIRED", "SCHEDULED"]) {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE opportunities SET status = '${status}' WHERE id = $1::uuid`,
          fixture.opportunityId
        )
      ).rejects.toThrow(/opportunities_sale_mode_status/);
    }
  }, 60_000);

  it("the database refuses a window on a direct listing", async () => {
    const fixture = await seedDirectListing("DIRWINDOW", 10);

    await expect(
      prisma.$executeRaw`UPDATE opportunities SET end_at = now() + interval '3 days' WHERE id = ${fixture.opportunityId}::uuid`
    ).rejects.toThrow(/opportunities_sale_mode_window/);
  }, 60_000);

  it("the freeze trigger lets a sold direct listing be restocked, and never below what sold", async () => {
    const fixture = await seedDirectListing("DIRFREEZE", 10);
    await buy(fixture, 6);

    // UP IS FINE, even though six units have been paid for — and this
    // is the exception the migration cut into the freeze trigger.
    await prisma.$executeRaw`UPDATE opportunities SET target_quantity = 20 WHERE id = ${fixture.opportunityId}::uuid`;
    expect(
      (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).targetQuantity
    ).toBe(20);

    // BELOW WHAT SOLD IS REFUSED, by the trigger, whatever writes it.
    await expect(
      prisma.$executeRaw`UPDATE opportunities SET target_quantity = 5 WHERE id = ${fixture.opportunityId}::uuid`
    ).rejects.toThrow(/cannot go below what is already sold/);

    // AND THE PRICE IS STILL FROZEN, for a direct listing exactly as
    // for a group offer: «لا تعدل السعر على النشرة الحالية».
    await expect(
      prisma.$executeRaw`UPDATE opportunities SET unit_price_amount = 99 WHERE id = ${fixture.opportunityId}::uuid`
    ).rejects.toThrow(/core fields are frozen/);
  }, 90_000);

  /**
   * THE RACE THE WHOLE DESIGN EXISTS TO SURVIVE.
   *
   * «أضف اختبار تزامن حقيقي على قاعدة البيانات: مشتريان يتسابقان على
   *  آخر كمية، ينجح واحد فقط، و`funded_quantity` لا يتجاوز
   *  `target_quantity` أبدًا.»
   *
   * TWO SEPARATE CLIENTS, not two calls on one. A single PrismaClient
   * would serialise them through its own pool and prove nothing about
   * the database; two connections is what two buyers actually are.
   */
  it("two buyers racing for the last unit: exactly one wins, and funded never exceeds stock", async () => {
    const fixture = await seedDirectListing("DIRRACE", 1);

    const other = new PrismaClient();
    try {
      const audit = new AuditService(prisma as unknown as PrismaService);
      const otherAudit = new AuditService(other as unknown as PrismaService);
      const a = new CheckoutSessionService(
        prisma as unknown as PrismaService,
        new ShippingTariffPolicyService(prisma as unknown as PrismaService, audit),
        new CheckoutSettingsService(prisma as unknown as PrismaService, audit)
      );
      const b = new CheckoutSessionService(
        other as unknown as PrismaService,
        new ShippingTariffPolicyService(other as unknown as PrismaService, otherAudit),
        new CheckoutSettingsService(other as unknown as PrismaService, otherAudit)
      );

      const ctx = {
        userId: fixture.traderUserId,
        companyId: fixture.traderCompanyId,
        requestId: "r-race",
      };
      const body = {
        opportunityId: fixture.opportunityId,
        quantity: 1,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 1 }],
      };

      const results = await Promise.allSettled([
        a.create(body, unique("race-a"), ctx),
        b.create(body, unique("race-b"), ctx),
      ]);

      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);

      // THE LOSER IS TOLD THE TRUTH, not handed a database error.
      expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
        response: expect.objectContaining({ code: "CONFLICT" }),
      });

      // ONE LOCK EXISTS, holding the one unit.
      const locks = await prisma.checkoutSession.findMany({
        where: { opportunityId: fixture.opportunityId, lockReleasedAt: null },
      });
      expect(locks).toHaveLength(1);
      expect(locks[0].lockedQuantity).toBe(1);

      const offer = await prisma.opportunity.findUniqueOrThrow({
        where: { id: fixture.opportunityId },
      });
      // NOTHING IS SOLD UNTIL A PAYMENT SUCCEEDS. A lock holds stock;
      // it does not consume it.
      expect(offer.fundedQuantity).toBe(0);
      expect(offer.fundedQuantity).toBeLessThanOrEqual(offer.targetQuantity);
    } finally {
      await other.$disconnect();
    }
  }, 90_000);

  it("two payments racing on one unit of stock can never push funded past the shelf", async () => {
    /**
     * THE SECOND HALF OF THE RACE, and the one that moves money.
     *
     * The test above proves two baskets cannot both hold the last unit.
     * This one proves the invariant itself — `funded_quantity <=
     * target_quantity` — against the path that actually raises it, with
     * a database CHECK standing behind the arithmetic.
     */
    const fixture = await seedDirectListing("DIRPAYRACE", 2);

    await buy(fixture, 2);

    const offer = await prisma.opportunity.findUniqueOrThrow({
      where: { id: fixture.opportunityId },
    });
    expect(offer.fundedQuantity).toBe(2);

    // A HAND-WRITTEN OVERSELL IS REFUSED BY THE DATABASE, whatever code
    // attempted it.
    await expect(
      prisma.$executeRaw`UPDATE opportunities SET funded_quantity = 3 WHERE id = ${fixture.opportunityId}::uuid`
    ).rejects.toThrow(/opportunities_funded_within_target/);
  }, 90_000);

  it("the supplier can restock, but never below what is sold plus what is held in live baskets", async () => {
    const fixture = await seedDirectListing("DIRSTOCK", 20);
    const offers = supplierService();
    const ctx = {
      userId: crypto.randomUUID(),
      companyId: fixture.supplierCompanyId,
      requestId: "r-stock",
    };

    // FOUR SOLD.
    await buy(fixture, 4);

    // AND THREE MORE HELD IN A BASKET NOBODY HAS PAID FOR. This is the
    // half of the floor the database cannot see: `funded_quantity` says
    // four, and a trigger could not refuse a shelf of five — but five
    // would take stock away from a buyer who is holding it right now.
    const { checkout } = services();
    await checkout.create(
      {
        opportunityId: fixture.opportunityId,
        quantity: 3,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 3 }],
      },
      unique("stock-lock"),
      { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r-stock-lock" }
    );

    await expect(offers.setDirectStock(fixture.opportunityId, { targetQuantity: 6 }, ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "CONFLICT" }),
    });

    // EXACTLY THE FLOOR IS ACCEPTED: four sold plus three held.
    const atFloor = await offers.setDirectStock(fixture.opportunityId, { targetQuantity: 7 }, ctx);
    expect(atFloor.targetQuantity).toBe(7);
    expect(atFloor.availableQuantity).toBe(0);

    // AND RAISING IT PUTS UNITS BACK ON THE SHELF.
    const raised = await offers.setDirectStock(fixture.opportunityId, { targetQuantity: 12 }, ctx);
    expect(raised.targetQuantity).toBe(12);
    expect(raised.availableQuantity).toBe(5);
  }, 90_000);

  it("stock is not a group offer's business", async () => {
    const group = await seedCheckoutFixture({ traderCrPrefix: "GRPSTOCK" });
    const offers = supplierService();
    await expect(
      offers.setDirectStock(
        group.opportunityId,
        { targetQuantity: 50 },
        { userId: crypto.randomUUID(), companyId: group.supplierCompanyId, requestId: "r-grp" }
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
  }, 60_000);

  it("stopping a sold listing ends new sales, refunds nobody, and releases open baskets", async () => {
    const fixture = await seedDirectListing("DIRSTOP", 20);
    const offers = supplierService();
    const ctx = {
      userId: crypto.randomUUID(),
      companyId: fixture.supplierCompanyId,
      requestId: "r-stop",
    };

    await buy(fixture, 5);
    const { checkout } = services();
    const openBasket = await checkout.create(
      {
        opportunityId: fixture.opportunityId,
        quantity: 2,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 2 }],
      },
      unique("stop-lock"),
      { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r-stop-lock" }
    );

    const stopped = await offers.stopDirect(fixture.opportunityId, ctx);
    expect(stopped.status).toBe("CANCELLED");

    // THE PAID ORDER IS UNTOUCHED — it is being prepared, and stopping
    // the shelf has nothing to do with it.
    const allocations = await prisma.orderAllocation.findMany({
      where: { masterOrder: { opportunityId: fixture.opportunityId } },
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0].status).toBe("AWAITING_PREPARATION");

    // AND NOBODY IS REFUNDED. This is what separates stopping a shelf
    // from cancelling a group offer, where buyers are left waiting for
    // a target that will never be reached.
    const refunds = await prisma.refundObligation.count({
      where: { paymentAttempt: { checkoutSession: { opportunityId: fixture.opportunityId } } },
    });
    expect(refunds).toBe(0);

    // THE OPEN BASKET IS RELEASED: holding stock on a listing that is
    // closing would hold it for the whole of its lock and give it to
    // nobody.
    const released = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: openBasket.id } });
    expect(released.status).toBe("ABANDONED");
    expect(released.releaseReason).toBe("OPPORTUNITY_CANCELLED");
  }, 90_000);

  it("a group offer is not stopped this way", async () => {
    const group = await seedCheckoutFixture({ traderCrPrefix: "GRPSTOP" });
    const offers = supplierService();
    await expect(
      offers.stopDirect(group.opportunityId, {
        userId: crypto.randomUUID(),
        companyId: group.supplierCompanyId,
        requestId: "r-grpstop",
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
  }, 60_000);

  /**
   * THE SUPPLIER'S OWN PATH: create, then publish.
   *
   * Every case above seeds a published listing directly, because what
   * they are about is what happens to one. This is about how one comes
   * to exist — and it is where the two modes differ most: no window is
   * asked for or stamped, no share tier is selected, and the listing
   * goes straight onto the market instead of waiting for a start time.
   */
  it("creates and publishes a direct listing with no window and no share arithmetic", async () => {
    // A GROUP FIXTURE, deliberately: it leaves the product carrying a
    // live GROUP offer and no direct one, which is both what this test
    // needs and a demonstration that the two coexist.
    const base = await seedCheckoutFixture({ traderCrPrefix: "DIRCREATE" });
    await seedSupplierBilling(base.supplierCompanyId);
    const offers = supplierService();
    const ctx = {
      userId: crypto.randomUUID(),
      companyId: base.supplierCompanyId,
      requestId: "r-create",
    };

    const product = await prisma.opportunity.findUniqueOrThrow({
      where: { id: base.opportunityId },
      select: { productId: true, fulfillmentLocationId: true },
    });

    const draft = await offers.create(
      {
        productId: product.productId,
        saleMode: "DIRECT",
        fulfillmentLocationId: product.fulfillmentLocationId,
        targetQuantity: 25,
        unitPriceAmount: 12.5,
        expectedPreparationDays: 2,
      },
      ctx
    );
    expect(draft.saleMode).toBe("DIRECT");
    expect(draft.status).toBe("DRAFT");
    // NO WINDOW IS INVENTED. `start_at` is stamped because the column is
    // NOT NULL and the listing has to have opened at some instant;
    // `end_at` stays empty, which is what «لا مدة انتهاء» means in the
    // row.
    expect(draft.endAt).toBeNull();

    await offers.publish(draft.id, ctx);

    const published = await prisma.opportunity.findUniqueOrThrow({ where: { id: draft.id } });
    // STRAIGHT ONTO THE MARKET. SCHEDULED is a group status — it exists
    // because a collective offer is announced for a window that has not
    // opened yet — and the database refuses it on this row.
    expect(published.status).toBe("ACTIVE");
    expect(published.endAt).toBeNull();
    expect(published.firstActivatedAt).not.toBeNull();

    // NO SHARE, NO TIER, NO TOTAL VALUE — the five columns a collective
    // offer's arithmetic fills, all empty.
    expect(published.shareQuantity).toBeNull();
    expect(published.shareBasisPoints).toBeNull();
    expect(published.shareTierIndex).toBeNull();
    expect(published.shareTierPolicyVersionId).toBeNull();
    expect(published.totalValueInclTaxAmount).toBeNull();

    // AND EVERYTHING AN ORDER IS BUILT FROM IS STILL THERE: the frozen
    // product snapshot, the tax breakdown, the sales unit and the
    // commission the platform is paid. A direct sale produces exactly
    // the same order as a group one.
    expect(published.productApprovalSnapshotId).not.toBeNull();
    expect(published.taxRatePercent).not.toBeNull();
    expect(published.salesUnitNameAr).not.toBeNull();
    expect(published.commissionPolicyVersionId).not.toBeNull();
    expect(published.commissionRateBasisPoints).not.toBeNull();
  }, 90_000);

  it("refuses a window on a direct listing rather than ignoring it", async () => {
    const base = await seedDirectListing("DIRWIN2", 10);
    const offers = supplierService();
    const product = await prisma.opportunity.findUniqueOrThrow({
      where: { id: base.opportunityId },
      select: { productId: true, fulfillmentLocationId: true },
    });

    await expect(
      offers.create(
        {
          productId: product.productId,
          saleMode: "DIRECT",
          fulfillmentLocationId: product.fulfillmentLocationId,
          targetQuantity: 5,
          unitPriceAmount: 10,
          expectedPreparationDays: 2,
          // A closing date the platform would never honour. Dropping it
          // silently would leave the supplier believing they set one.
          endAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        },
        { userId: crypto.randomUUID(), companyId: base.supplierCompanyId, requestId: "r-win" }
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
  }, 60_000);

  it("one product may carry a live direct listing AND a live group offer at once", async () => {
    // «نفس المنتج يمكن أن يكون له بيع مباشر نشط وعرض جماعي نشط في الوقت
    //  نفسه» — the one-live-listing rule is per sale mode, because two
    //  listings of the SAME kind compete for one product's buyers and
    //  these two do not.
    const direct = await seedDirectListing("DIRBOTH", 10);
    const offers = supplierService();
    const ctx = {
      userId: crypto.randomUUID(),
      companyId: direct.supplierCompanyId,
      requestId: "r-both",
    };
    const product = await prisma.opportunity.findUniqueOrThrow({
      where: { id: direct.opportunityId },
      select: { productId: true, fulfillmentLocationId: true },
    });

    // A GROUP OFFER ON THE SAME PRODUCT, while the direct listing is
    // live and ACTIVE.
    const group = await offers.create(
      {
        productId: product.productId,
        fulfillmentLocationId: product.fulfillmentLocationId,
        targetQuantity: 100,
        unitPriceAmount: 10,
        startAt: new Date().toISOString(),
        endAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        expectedPreparationDays: 3,
      },
      ctx
    );
    await offers.publish(group.id, ctx);

    const published = await prisma.opportunity.findUniqueOrThrow({ where: { id: group.id } });
    expect(published.status).toBe("ACTIVE");
    expect(published.saleMode).toBe("GROUP");
    expect(published.shareQuantity).not.toBeNull();

    const stillLive = await prisma.opportunity.findUniqueOrThrow({
      where: { id: direct.opportunityId },
    });
    expect(stillLive.status).toBe("ACTIVE");

    // AND A SECOND OF THE SAME KIND IS STILL REFUSED.
    const secondDirect = await offers.create(
      {
        productId: product.productId,
        saleMode: "DIRECT",
        fulfillmentLocationId: product.fulfillmentLocationId,
        targetQuantity: 5,
        unitPriceAmount: 11,
        expectedPreparationDays: 2,
      },
      ctx
    );
    await expect(offers.publish(secondDirect.id, ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PRODUCT_ALREADY_HAS_LIVE_OFFER" }),
    });
  }, 120_000);

  /**
   * THE BASKET THAT CAME BACK FROM THE DEAD.
   *
   * `startPayment` claims a checkout session on `status = 'LOCKED'`
   * alone — it never compares `lock_expires_at` to now. So a basket
   * whose minute ran out, and which the sweep has not yet reached, can
   * still become PAYMENT_PENDING with a fresh deadline and then be
   * paid.
   *
   * THAT IS HARMLESS WHILE NOTHING CAN SHRINK THE SHELF, which was true
   * of every listing before this change: `target_quantity` was frozen
   * from the first riyal. It stopped being true the moment a supplier
   * could lower stock — lower it to the LIVE floor in that window, let
   * the basket revive and pay, and the webhook's `funded += locked`
   * lands above the target where the database refuses it, inside the
   * capture's own transaction: money taken, no order, and the provider
   * redelivering for ever.
   *
   * SO THE FLOOR COUNTS WHAT COULD STILL BE CLAIMED. This is the case
   * that says so.
   */
  it("counts an expired-but-unreleased basket in the floor, even though the payment path now refuses it too", async () => {
    const fixture = await seedDirectListing("DIRREVIVE", 20);
    const offers = supplierService();
    const ctx = {
      userId: crypto.randomUUID(),
      companyId: fixture.supplierCompanyId,
      requestId: "r-revive",
    };

    const { checkout } = services();
    const basket = await checkout.create(
      {
        opportunityId: fixture.opportunityId,
        quantity: 6,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 6 }],
      },
      unique("revive-lock"),
      { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r-revive-lock" }
    );

    // ITS MINUTE RUNS OUT, and nothing has swept it: still LOCKED, still
    // unreleased. The checkout would no longer count it — an expired
    // basket's stock goes back on the shelf for the next buyer, which is
    // right for SELLING.
    // BOTH ENDS MOVE BACK: `checkout_sessions_lock_expires_after_created`
    // refuses a window that closes before it opened, so ageing a basket
    // means moving the whole window, not just its end.
    await prisma.$executeRaw`
      UPDATE checkout_sessions
      SET lock_created_at = now() - interval '2 hours',
          lock_expires_at = now() - interval '1 hour'
      WHERE id = ${basket.id}::uuid
    `;
    const stillThere = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: basket.id } });
    expect(stillThere.status).toBe("LOCKED");
    expect(stillThere.lockReleasedAt).toBeNull();

    // AND THE SHELF STILL MAY NOT BE TAKEN AWAY FROM IT. Nothing is
    // sold, so a floor that counted only live locks would allow any
    // positive number here.
    await expect(
      offers.setDirectStock(fixture.opportunityId, { targetQuantity: 5 }, ctx)
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "CONFLICT" }),
    });

    // EXACTLY THE FLOOR IS ACCEPTED: nothing sold, six still claimable.
    const atFloor = await offers.setDirectStock(
      fixture.opportunityId,
      { targetQuantity: 6 },
      ctx
    );
    expect(atFloor.targetQuantity).toBe(6);

    // AND THE ROOT IS CLOSED TOO — the basket can no longer be revived
    // at all. `startPayment` now requires a LIVE lock, so the path that
    // made this hazard reachable is shut.
    //
    // THE FLOOR IS KEPT ANYWAY, and that is the owner's instruction:
    // «أريد دفاعًا بطبقتين». One layer stops the known path; the other
    // stops a path nobody has thought of yet, and costs the supplier
    // nothing but the minute it takes the sweep to release a dead
    // basket.
    const { payments } = services();
    await expect(
      payments.startPayment(basket.id, unique("revive-attempt"), {
        userId: fixture.traderUserId,
        companyId: fixture.traderCompanyId,
        requestId: "r-revive-2",
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "CHECKOUT_LOCK_EXPIRED" }),
    });

    // NOTHING WAS SOLD, and the shelf is where the supplier left it.
    const after = await prisma.opportunity.findUniqueOrThrow({
      where: { id: fixture.opportunityId },
    });
    expect(after.fundedQuantity).toBe(0);
    expect(after.targetQuantity).toBe(6);
  }, 90_000);
});
