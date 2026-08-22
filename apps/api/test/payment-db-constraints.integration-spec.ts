import { PrismaClient } from "@prisma/client";
import { seedPaymentFixture, paymentFixturePrisma } from "./fixtures/payment.fixture";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { PaymentWebhookService } from "../src/payments/payment-webhook.service";
import { CommissionTaxPolicyService } from "../src/settings/commission-tax-policy.service";
import { AuditService } from "../src/audit/audit.service";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = paymentFixturePrisma;

describe("Phase 7C direct DB constraint breakage (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("rejects LOCKED with a non-NULL paymentDeadlineAt", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "CHKDEAD1" });
    await expect(
      prisma.$executeRaw`UPDATE checkout_sessions SET status = 'LOCKED', payment_deadline_at = now() WHERE id = ${fixture.checkoutSessionId}::uuid`
    ).rejects.toThrow(/checkout_sessions_payment_deadline_consistency/);
  });

  it("rejects PAYMENT_PENDING with a NULL paymentDeadlineAt", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "CHKDEAD2" });
    await expect(
      prisma.$executeRaw`UPDATE checkout_sessions SET payment_deadline_at = NULL WHERE id = ${fixture.checkoutSessionId}::uuid`
    ).rejects.toThrow(/checkout_sessions_payment_deadline_consistency/);
  });

  it("rejects PAID with a NULL capturedAt even if lockReleasedAt/paymentDeadlineAt are set", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "CHKPAID1" });
    await expect(
      prisma.$executeRaw`
        UPDATE checkout_sessions
        SET status = 'PAID', lock_released_at = now(), release_reason = NULL, captured_at = NULL
        WHERE id = ${fixture.checkoutSessionId}::uuid
      `
    ).rejects.toThrow(/checkout_sessions_status_release_consistency/);
  });

  it("rejects a SUCCESS provider_payment_events row with NULL provider_captured_at", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "CHKEVT1" });
    await expect(
      prisma.providerPaymentEvent.create({
        data: {
          provider: "MOCK",
          providerEventId: `bad-success-${fixture.paymentAttemptId}`,
          paymentAttemptId: fixture.paymentAttemptId,
          eventType: "SUCCESS",
          providerCapturedAt: null,
          processingOutcome: "ORDER_CREATED",
          payloadHash: "x",
          payloadMetadataRedacted: {},
        },
      })
    ).rejects.toThrow(/provider_payment_events_success_captured_at_required/);
  });

  it("accepts a FAILURE provider_payment_events row with NULL provider_captured_at (control case)", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "CHKEVT2" });
    await expect(
      prisma.providerPaymentEvent.create({
        data: {
          provider: "MOCK",
          providerEventId: `good-failure-${fixture.paymentAttemptId}`,
          paymentAttemptId: fixture.paymentAttemptId,
          eventType: "FAILURE",
          providerCapturedAt: null,
          processingOutcome: "PAYMENT_FAILED",
          payloadHash: "x",
          payloadMetadataRedacted: {},
        },
      })
    ).resolves.toBeDefined();
  });

  it("rejects a negative providerFeeAmount on payment_attempts", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "CHKFEE1" });
    await expect(
      prisma.$executeRaw`UPDATE payment_attempts SET provider_fee_amount = -1 WHERE id = ${fixture.paymentAttemptId}::uuid`
    ).rejects.toThrow(/payment_attempts_provider_fee_non_negative/);
  });

  it("rejects a second CREATED/PENDING payment_attempts row for the same checkout session (partial unique index)", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "CHKPART1" });
    await expect(
      prisma.paymentAttempt.create({
        data: {
          checkoutSessionId: fixture.checkoutSessionId,
          providerCode: "MOCK",
          idempotencyKey: "dup-key",
          amount: fixture.providerAmount,
          currency: "SAR",
        },
      })
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it("MasterOrder rows cannot have their core fields mutated after creation (only status may progress)", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "CHKORDMUT" });
    const mockProvider = new MockPaymentProvider();
    const audit = new AuditService(prisma as never);
    const service = new PaymentWebhookService(prisma as never, new CommissionTaxPolicyService(prisma as never, audit), mockProvider, notificationEvents());

    const { rawBody, headers } = mockProvider.buildSignedWebhook({
      merchantReference: fixture.merchantReference,
      providerReference: `ref-${fixture.merchantReference}`,
      providerEventId: `evt-${fixture.merchantReference}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: fixture.providerAmount,
    });
    const result = await service.handleWebhook(rawBody, headers);

    await expect(
      prisma.$executeRaw`UPDATE master_orders SET total_amount = 999 WHERE id = ${result.masterOrderId}::uuid`
    ).rejects.toThrow(/master_orders: core fields are frozen/);

    await expect(prisma.$executeRaw`DELETE FROM master_orders WHERE id = ${result.masterOrderId}::uuid`).rejects.toThrow(
      /master_orders: rows cannot be deleted/
    );
  }, 30_000);
});
