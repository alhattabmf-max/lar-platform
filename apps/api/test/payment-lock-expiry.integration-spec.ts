import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { CheckoutSessionService } from "../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../src/settings/checkout-settings.service";
import { AuditService } from "../src/audit/audit.service";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { seedSupplierBilling } from "./fixtures/fulfillment.fixture";
import { ensureCommissionTaxPolicy, buildPaymentAttemptService } from "./fixtures/payment.fixture";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";

/**
 * A PAYMENT MAY NOT BE STARTED FROM A DEAD BASKET.
 *
 * «عند startPayment لا يكفي أن تكون الحالة LOCKED؛ يجب كذلك أن يكون
 *  lock_expires_at > now(). إذا انتهى القفل، ارفض بدء الدفع… ولا تحاول
 *  إحياء الجلسة أو تمديدها تلقائيًا. المشتري ينشئ Checkout جديدًا
 *  ويحصل على الكمية المتاحة الحالية.»
 *
 * WHY THE STATUS ALONE WAS NOT ENOUGH. A basket becomes EXPIRED by a
 * sweep that runs every minute, and by a lazy cleanup that only fires
 * for the same trader on the same offer. Between the instant
 * `lock_expires_at` passes and the instant something notices, the row
 * still SAYS `LOCKED` — and claiming it moved it to PAYMENT_PENDING
 * with a fresh deadline, which is a dead basket brought back to life
 * holding stock that had already gone back on the shelf.
 *
 * ONE RULE FOR BOTH SALE MODES, because a lock means the same thing in
 * both: units held for one buyer, for a bounded time. These cases run
 * the same scenario twice — once on a group offer, once on a direct
 * listing — so neither mode can drift.
 */
const prisma = checkoutFixturePrisma;
const provider = new MockPaymentProvider();

/** The real attempt service, on the same database and the mock provider. */
function payments() {
  return buildPaymentAttemptService(prisma as unknown as PrismaService, provider);
}

function checkoutService() {
  const p = prisma as unknown as PrismaService;
  const audit = new AuditService(p);
  return new CheckoutSessionService(
    p,
    new ShippingTariffPolicyService(p, audit),
    new CheckoutSettingsService(p, audit)
  );
}

const unique = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * A fixture, a supplier who can be paid, and one basket holding four
 * units of it.
 */
async function seedBasket(prefix: string, saleMode: "GROUP" | "DIRECT") {
  const fixture = await seedCheckoutFixture({
    traderCrPrefix: prefix,
    saleMode,
    targetQuantity: 100,
  });
  await seedSupplierBilling(fixture.supplierCompanyId);

  const session = await checkoutService().create(
    {
      opportunityId: fixture.opportunityId,
      quantity: 4,
      allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
    },
    unique(`${prefix}-checkout`),
    {
      userId: fixture.traderUserId,
      companyId: fixture.traderCompanyId,
      requestId: `r-${prefix}`,
    }
  );

  return { fixture, session };
}

/**
 * Moves a basket's whole window into the past.
 *
 * BOTH ENDS, because `checkout_sessions_lock_expires_after_created`
 * refuses a window that closes before it opened. The status is left
 * exactly as it was — `LOCKED` — which is the whole point: this is the
 * row as it looks in the minute before a sweep reaches it.
 */
async function ageTheLock(sessionId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE checkout_sessions
    SET lock_created_at = now() - interval '2 hours',
        lock_expires_at = now() - interval '1 hour'
    WHERE id = ${sessionId}::uuid
  `;
}

describe("starting a payment needs a LIVE lock (integration, real DB)", () => {
  beforeAll(async () => {
    await ensureCommissionTaxPolicy();
  });

  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  describe.each(["GROUP", "DIRECT"] as const)("on a %s listing", (saleMode) => {
    it("a live lock starts a payment, and the basket becomes PAYMENT_PENDING", async () => {
      const { fixture, session } = await seedBasket(`LIVE${saleMode}`, saleMode);

      const attempt = await payments().startPayment(
        session.id,
        unique("live-attempt"),
        {
          userId: fixture.traderUserId,
          companyId: fixture.traderCompanyId,
          requestId: "r-live",
        }
      );
      expect(attempt.id).toBeTruthy();

      const after = await prisma.checkoutSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(after.status).toBe("PAYMENT_PENDING");
      // AND A DEADLINE WAS SET — the thing the payment path is allowed
      // to write, on a basket that was entitled to one.
      expect(after.paymentDeadlineAt).not.toBeNull();
    }, 60_000);

    it("an expired lock is refused, with its own code", async () => {
      const { fixture, session } = await seedBasket(`DEAD${saleMode}`, saleMode);
      await ageTheLock(session.id);

      // STILL `LOCKED` ON THE ROW. Nothing has swept it, which is
      // exactly the window this rule closes.
      const before = await prisma.checkoutSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(before.status).toBe("LOCKED");
      expect(before.lockReleasedAt).toBeNull();

      await expect(
        payments().startPayment(session.id, unique("dead-attempt"), {
          userId: fixture.traderUserId,
          companyId: fixture.traderCompanyId,
          requestId: "r-dead",
        })
      ).rejects.toMatchObject({
        // NOT `PAYMENT_ATTEMPT_ALREADY_ACTIVE`: that one means a payment
        // is under way and the buyer should wait. This means the basket
        // is gone and they must start again — opposite instructions.
        response: expect.objectContaining({ code: "CHECKOUT_LOCK_EXPIRED" }),
      });
    }, 60_000);

    it("the expired basket is NOT moved to PAYMENT_PENDING, and no attempt is written", async () => {
      const { fixture, session } = await seedBasket(`NOPP${saleMode}`, saleMode);
      await ageTheLock(session.id);

      await expect(
        payments().startPayment(session.id, unique("nopp-attempt"), {
          userId: fixture.traderUserId,
          companyId: fixture.traderCompanyId,
          requestId: "r-nopp",
        })
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CHECKOUT_LOCK_EXPIRED" }),
      });

      const after = await prisma.checkoutSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      // NOT REVIVED: no fresh deadline, no new status.
      expect(after.status).toBe("LOCKED");
      expect(after.paymentDeadlineAt).toBeNull();
      // AND NOT EXTENDED EITHER — the window is where it was. Marking
      // the row EXPIRED belongs to the sweep that owns that transition;
      // this path refuses and writes nothing at all.
      expect(after.lockExpiresAt.getTime()).toBeLessThan(Date.now());
      expect(after.lockReleasedAt).toBeNull();

      const attempts = await prisma.paymentAttempt.count({
        where: { checkoutSessionId: session.id },
      });
      expect(attempts).toBe(0);
    }, 60_000);

    it("refusing one basket leaves a live basket on the same listing untouched", async () => {
      // THE REFUSAL IS ABOUT ONE ROW. A rule that reached further would
      // be taking stock from a buyer who is still inside their minutes.
      const { fixture, session: dead } = await seedBasket(`MIX${saleMode}`, saleMode);
      await ageTheLock(dead.id);

      await expect(
        payments().startPayment(dead.id, unique("mix-dead"), {
          userId: fixture.traderUserId,
          companyId: fixture.traderCompanyId,
          requestId: "r-mix-dead",
        })
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CHECKOUT_LOCK_EXPIRED" }),
      });

      /**
       * AND THE BUYER DOES WHAT THE REFUSAL TOLD THEM: a new checkout.
       *
       * ORDER MATTERS HERE, and it is the platform's own behaviour
       * rather than this rule's. Opening a checkout runs a lazy cleanup
       * that releases THIS trader's expired lock on THIS offer first —
       * so the dead basket is EXPIRED by the time the new one exists,
       * and asking it for a payment afterwards would be refused for
       * being expired rather than for being dead. The dead one is
       * therefore asked before, and the new one after.
       */
      const live = await checkoutService().create(
        {
          opportunityId: fixture.opportunityId,
          quantity: 4,
          allocations: [
            { companyLocationId: fixture.traderLocations.sameRegionDifferentCity, quantity: 4 },
          ],
        },
        unique("mix-second"),
        {
          userId: fixture.traderUserId,
          companyId: fixture.traderCompanyId,
          requestId: "r-mix-2",
        }
      );

      const attempt = await payments().startPayment(
        live.id,
        unique("mix-live"),
        {
          userId: fixture.traderUserId,
          companyId: fixture.traderCompanyId,
          requestId: "r-mix-live",
        }
      );
      expect(attempt.id).toBeTruthy();

      // AND THE DEAD ONE ENDED UP WHERE IT BELONGS — released by the
      // cleanup, not by the payment path, which wrote nothing.
      const deadAfter = await prisma.checkoutSession.findUniqueOrThrow({
        where: { id: dead.id },
      });
      expect(deadAfter.status).toBe("EXPIRED");
      expect(deadAfter.paymentDeadlineAt).toBeNull();

      const liveAfter = await prisma.checkoutSession.findUniqueOrThrow({
        where: { id: live.id },
      });
      expect(liveAfter.status).toBe("PAYMENT_PENDING");
    }, 90_000);
  });

  /**
   * THE SECOND LAYER STAYS.
   *
   * «احتفظ أيضًا بحماية setDirectStock الأوسع؛ أريد دفاعًا بطبقتين.»
   * With the root closed, an expired basket can no longer be revived
   * through THIS path — and the stock floor still counts it, because
   * the floor's job is to survive a path nobody has thought of yet.
   */
  it("the DIRECT stock floor still counts an expired-but-unreleased basket", async () => {
    const { fixture, session } = await seedBasket("FLOORKEEP", "DIRECT");
    await ageTheLock(session.id);

    const locked = await prisma.$queryRaw<{ sum: number | null }[]>`
      SELECT COALESCE(SUM(locked_quantity), 0)::int AS sum FROM checkout_sessions
      WHERE opportunity_id = ${fixture.opportunityId}::uuid AND lock_released_at IS NULL
        AND status IN ('LOCKED', 'PAYMENT_PENDING')
    `;
    expect(locked[0].sum).toBe(4);

    // The narrower, selling-side reading counts nothing — which is
    // right for SELLING and is exactly why the floor may not use it.
    const live = await prisma.$queryRaw<{ sum: number | null }[]>`
      SELECT COALESCE(SUM(locked_quantity), 0)::int AS sum FROM checkout_sessions
      WHERE opportunity_id = ${fixture.opportunityId}::uuid AND lock_released_at IS NULL
        AND (
          (status = 'LOCKED' AND lock_expires_at > now())
          OR (status = 'PAYMENT_PENDING' AND payment_deadline_at > now())
        )
    `;
    expect(live[0].sum).toBe(0);
  }, 60_000);
});
