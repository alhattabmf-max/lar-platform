import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { PaymentWebhookService } from "../src/payments/payment-webhook.service";
import { CommissionTaxPolicyService } from "../src/settings/commission-tax-policy.service";
import { AuditService } from "../src/audit/audit.service";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { seedPaymentFixture, paymentFixturePrisma } from "./fixtures/payment.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

/**
 * Runs against a real PostgreSQL — there is no way to test a rollback
 * without one.
 *
 * WHY THIS EXISTS, and what it adds over
 * `src/payments/payment-webhook-atomicity.spec.ts`.
 *
 * That suite is STRUCTURAL. It reads the service's source and proves
 * that the PAID update, the `masterOrder.create`, the notification
 * writes and the outbox writes all name the same `tx` binding, and that
 * nothing inside the transaction reaches around it to `this.prisma`.
 * That is a real and useful guarantee — it is what catches the next
 * person adding a write on the wrong client — but it is a claim about
 * the CODE, not about the database.
 *
 * It cannot prove that PostgreSQL actually rolls those writes back
 * together. A structural test would still pass if the isolation level
 * were wrong, if a statement ran outside the transaction through some
 * path the regex does not see, or if a deferred constraint fired at
 * COMMIT and left the rest behind. Only executing a transaction and
 * failing it mid-way can show that.
 *
 * So these tests do the one thing the other cannot: force a failure
 * after the PAID transition and the order creation, and then assert
 * that NOTHING survives — no PAID session, no MasterOrder, no
 * notification, no outbox row, no ledger posting.
 *
 * The PAID ⇒ masterOrderId invariant in `CheckoutSessionView` rests on
 * exactly this. If a rollback could leave a PAID session without its
 * order, the discriminated union would be a promise the write path
 * does not keep, and the mapper would start raising
 * `CheckoutInvariantError` on real traffic.
 */

const prisma = paymentFixturePrisma;
const provider = new MockPaymentProvider();

function buildWebhookService(p: PrismaService) {
  const audit = new AuditService(p);
  return new PaymentWebhookService(p, new CommissionTaxPolicyService(p, audit), provider, notificationEvents());
}

/**
 * Everything the capture writes, read back in one place.
 *
 * Asserting on the full set rather than on one row is the point: a
 * partial rollback shows up as SOME of these surviving, and a check
 * that looked only at the order would miss a notification that
 * outlived the payment it announced.
 */
async function captureFootprint(checkoutSessionId: string) {
  const session = await prisma.checkoutSession.findUniqueOrThrow({
    where: { id: checkoutSessionId },
  });
  const order = await prisma.masterOrder.findUnique({ where: { checkoutSessionId } });

  return {
    status: session.status,
    capturedAt: session.capturedAt,
    order,
    orderAllocations: order
      ? await prisma.orderAllocation.count({ where: { masterOrderId: order.id } })
      : 0,
    notifications: order
      ? await prisma.notification.count({ where: { entityId: order.id } })
      : 0,
    // Postings hang off a JournalEntry, which references the order by
    // (referenceType, referenceId) rather than a foreign key.
    ledgerPostings: order
      ? await prisma.ledgerPosting.count({
          where: { journalEntry: { referenceType: "master_order", referenceId: order.id } },
        })
      : 0,
    outbox: await prisma.outboxEvent.count({
      where: { payload: { path: ["checkoutSessionId"], equals: checkoutSessionId } },
    }),
  };
}

describe("payment webhook — real rollback (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("leaves NO partial state when the transaction fails after the order is created", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "ROLLBACK1" });
    const before = await captureFootprint(fixture.checkoutSessionId);
    expect(before.status).toBe("PAYMENT_PENDING");
    expect(before.order).toBeNull();

    const service = buildWebhookService(prisma as unknown as PrismaService);

    // Fail LATE: after the PAID update, the MasterOrder, its
    // allocations, the notifications and the outbox rows have all been
    // written on the transaction. Failing before any of that would
    // prove nothing — there would be nothing to roll back.
    //
    // The ledger posting is the last thing the success path does, so
    // making it throw puts the failure at the far end of the
    // transaction with every prior write already issued.
    const postLedger = jest
      .spyOn(service as unknown as { postOrderLedger: () => Promise<void> }, "postOrderLedger")
      .mockRejectedValue(new Error("forced failure at the end of the capture"));

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.paymentAttemptId,
      providerReference: `ref-${fixture.paymentAttemptId}`,
      providerEventId: `evt-rollback-${Date.now()}`,
      eventType: "SUCCESS",
      currency: "SAR",
      // A SUCCESS CARRIES THE MOMENT OF CAPTURE. The webhook refuses one
      // that does not: the moment decides whether the lock was still
      // alive and which attempt won, and the column pair
      // (provider_captured_at, provider_captured_amount) must be whole.
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });

    await expect(service.handleWebhook(rawBody, headers)).rejects.toThrow();

    postLedger.mockRestore();

    const after = await captureFootprint(fixture.checkoutSessionId);

    // The session never became PAID.
    expect(after.status).toBe("PAYMENT_PENDING");
    expect(after.capturedAt).toBeNull();

    // No order, and therefore nothing hanging off one.
    expect(after.order).toBeNull();
    expect(after.orderAllocations).toBe(0);
    expect(after.ledgerPostings).toBe(0);

    // And nothing announcing a payment that did not happen. A
    // notification committed outside the capture's transaction is the
    // failure this asserts against: the trader would be told they paid
    // for an order that does not exist.
    expect(after.notifications).toBe(0);

    // The outbox is unchanged from before the attempt — the relay must
    // not have an email queued about a capture that rolled back.
    expect(after.outbox).toBe(before.outbox);
  }, 30_000);

  it("rolls back the idempotency claim too, so the webhook can be redelivered", async () => {
    // The claim is INSERTed on the same transaction. If it survived a
    // rollback, the provider's redelivery would find a claimed key,
    // read an incomplete row, and the capture would never be applied —
    // a payment taken and an order never created.
    const fixture = await seedPaymentFixture({ traderCrPrefix: "ROLLBACK2" });
    const service = buildWebhookService(prisma as unknown as PrismaService);
    const providerEventId = `evt-redeliver-${Date.now()}`;

    const postLedger = jest
      .spyOn(service as unknown as { postOrderLedger: () => Promise<void> }, "postOrderLedger")
      .mockRejectedValue(new Error("forced failure at the end of the capture"));

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.paymentAttemptId,
      providerReference: `ref-${fixture.paymentAttemptId}`,
      providerEventId,
      eventType: "SUCCESS",
      currency: "SAR",
      // A SUCCESS CARRIES THE MOMENT OF CAPTURE. The webhook refuses one
      // that does not: the moment decides whether the lock was still
      // alive and which attempt won, and the column pair
      // (provider_captured_at, provider_captured_amount) must be whole.
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });

    await expect(service.handleWebhook(rawBody, headers)).rejects.toThrow();

    const claim = await prisma.$queryRaw<{ key: string }[]>`
      SELECT key FROM idempotency_keys WHERE key = ${providerEventId}
    `;
    expect(claim).toHaveLength(0);

    // The redelivery now succeeds and applies the capture exactly once.
    postLedger.mockRestore();
    await service.handleWebhook(rawBody, headers);

    const after = await captureFootprint(fixture.checkoutSessionId);
    expect(after.status).toBe("PAID");
    expect(after.order).not.toBeNull();
    expect(after.notifications).toBeGreaterThan(0);
  }, 30_000);

  it("commits every write together on the success path", async () => {
    // The other half of the same guarantee. A reader who sees PAID must
    // see the order, because the discriminated union says so.
    const fixture = await seedPaymentFixture({ traderCrPrefix: "ROLLBACK3" });
    const service = buildWebhookService(prisma as unknown as PrismaService);

    const { rawBody, headers } = provider.buildSignedWebhook({
      merchantReference: fixture.paymentAttemptId,
      providerReference: `ref-${fixture.paymentAttemptId}`,
      providerEventId: `evt-commit-${Date.now()}`,
      eventType: "SUCCESS",
      currency: "SAR",
      // A SUCCESS CARRIES THE MOMENT OF CAPTURE. The webhook refuses one
      // that does not: the moment decides whether the lock was still
      // alive and which attempt won, and the column pair
      // (provider_captured_at, provider_captured_amount) must be whole.
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });

    await service.handleWebhook(rawBody, headers);

    const after = await captureFootprint(fixture.checkoutSessionId);

    expect(after.status).toBe("PAID");
    expect(after.capturedAt).not.toBeNull();
    expect(after.order).not.toBeNull();
    expect(after.orderAllocations).toBeGreaterThan(0);
    expect(after.notifications).toBeGreaterThan(0);
    expect(after.ledgerPostings).toBeGreaterThan(0);
  }, 30_000);
});
