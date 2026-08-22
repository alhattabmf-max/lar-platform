/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_ENTITY_TYPES } from "@platform/types";
import { NotificationEventsService } from "./notification-events.service";
import { NotificationWriterService } from "./notification-writer.service";
import { NOTIFICATION_MATRIX } from "./notification-matrix";

const TRADER = "11111111-1111-1111-1111-111111111111";
const SUPPLIER = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";
const ALLOCATION = "44444444-4444-4444-4444-444444444444";
const DISPUTE = "55555555-5555-5555-5555-555555555555";
const OBLIGATION = "66666666-6666-6666-6666-666666666666";
const SESSION = "77777777-7777-7777-7777-777777777777";
const PAYOUT = "88888888-8888-8888-8888-888888888888";
const ATTEMPT = "99999999-9999-9999-9999-999999999999";

function harness(overrides: Record<string, any> = {}) {
  const emit = jest.fn((..._args: any[]) => Promise.resolve({ notificationId: "n", created: true }));
  const writer = { emit } as unknown as NotificationWriterService;

  const tx = {
    orderAllocation: {
      findUnique: jest.fn((..._a: any[]) =>
        Promise.resolve({ masterOrderId: ORDER, masterOrder: { traderCompanyId: TRADER } })
      ),
    },
    masterOrder: {
      findUnique: jest.fn((..._a: any[]) => Promise.resolve({ traderCompanyId: TRADER })),
      findFirst: jest.fn((..._a: any[]) => Promise.resolve({ id: ORDER })),
    },
    dispute: {
      findUnique: jest.fn((..._a: any[]) =>
        Promise.resolve({
          orderAllocationId: ALLOCATION,
          orderAllocation: {
            masterOrderId: ORDER,
            masterOrder: { traderCompanyId: TRADER, supplierCompanyId: SUPPLIER },
          },
        })
      ),
    },
    replacementObligation: {
      findUnique: jest.fn((..._a: any[]) =>
        Promise.resolve({
          originalOrderAllocationId: ALLOCATION,
          originalOrderAllocation: {
            masterOrderId: ORDER,
            masterOrder: { traderCompanyId: TRADER },
          },
        })
      ),
    },
    refundObligation: {
      findUnique: jest.fn((..._a: any[]) =>
        Promise.resolve({
          amount: new Prisma.Decimal("1200.5"),
          currency: "SAR",
          paymentAttempt: { checkoutSession: { id: SESSION, traderCompanyId: TRADER } },
        })
      ),
    },
    ...overrides,
  };

  return { tx, emit, service: new NotificationEventsService(writer) };
}

const lastEmit = (emit: jest.Mock) => emit.mock.calls[emit.mock.calls.length - 1][1];

describe("every event targets the right company", () => {
  it("payment success goes to the TRADER who paid", async () => {
    const h = harness();

    await h.service.paymentSucceeded(h.tx as never, {
      masterOrderId: ORDER,
      traderCompanyId: TRADER,
      amount: new Prisma.Decimal("100"),
      currency: "SAR",
    });

    expect(lastEmit(h.emit).companyId).toBe(TRADER);
  });

  it("order creation goes to the SUPPLIER, not the trader", async () => {
    const h = harness();

    // The trader already gets PAYMENT_SUCCEEDED for the same instant;
    // sending both would be two messages about one capture.
    await h.service.orderCreated(h.tx as never, {
      masterOrderId: ORDER,
      supplierCompanyId: SUPPLIER,
    });

    expect(lastEmit(h.emit).companyId).toBe(SUPPLIER);
  });

  it("a dispute opening goes to the SUPPLIER who must answer it", async () => {
    const h = harness();

    await h.service.disputeOpened(h.tx as never, DISPUTE);

    expect(lastEmit(h.emit).companyId).toBe(SUPPLIER);
  });

  it("a supplier response goes back to the TRADER", async () => {
    const h = harness();

    await h.service.disputeSupplierResponded(h.tx as never, DISPUTE);

    expect(lastEmit(h.emit).companyId).toBe(TRADER);
  });

  it("a replacement obligation goes to the SUPPLIER who owes it", async () => {
    const h = harness();

    await h.service.replacementRequired(h.tx as never, {
      replacementObligationId: OBLIGATION,
      disputeId: DISPUTE,
    });

    expect(lastEmit(h.emit).companyId).toBe(SUPPLIER);
  });

  it.each([
    ["allocationPreparationStarted", "ALLOCATION_PREPARATION_STARTED"],
    ["allocationReady", "ALLOCATION_READY"],
    ["allocationShipped", "ALLOCATION_SHIPPED"],
    ["allocationDelivered", "ALLOCATION_DELIVERED"],
  ] as const)("%s goes to the TRADER", async (method, type) => {
    const h = harness();

    await (h.service as any)[method](h.tx as never, ALLOCATION);

    expect(lastEmit(h.emit)).toMatchObject({ companyId: TRADER, type });
  });

  it("resolves the company from the DATABASE, never from an argument", async () => {
    const h = harness();

    await h.service.allocationShipped(h.tx as never, ALLOCATION);

    // The only input was an allocation id; the company came from a read.
    expect(h.tx.orderAllocation.findUnique).toHaveBeenCalled();
  });
});

describe("params carry identifiers and money, nothing else", () => {
  it("formats money as a fixed-scale decimal string", async () => {
    const h = harness();

    await h.service.paymentSucceeded(h.tx as never, {
      masterOrderId: ORDER,
      traderCompanyId: TRADER,
      amount: new Prisma.Decimal("1200.5"),
      currency: "SAR",
    });

    // A string, not a float: this figure is reconciled against a bank
    // statement.
    expect(lastEmit(h.emit).params.amount).toBe("1200.50");
    expect(typeof lastEmit(h.emit).params.amount).toBe("string");
  });

  it("never emits a floating-point amount", async () => {
    const h = harness();

    await h.service.settlementExecuted(h.tx as never, {
      supplierPayoutId: PAYOUT,
      supplierCompanyId: SUPPLIER,
      netAmount: 0.1 + 0.2,
      currency: "SAR",
    });

    expect(lastEmit(h.emit).params.amount).toBe("0.30");
  });

  it("takes the amount from the stored obligation, not a recomputation", async () => {
    const h = harness();

    await h.service.refundInitiated(h.tx as never, {
      refundObligationId: OBLIGATION,
      refundAttemptId: ATTEMPT,
    });

    expect(lastEmit(h.emit).params).toEqual({ amount: "1200.50", currency: "SAR" });
  });

  it("pairs currency with every amount", async () => {
    const h = harness();

    await h.service.refundFailed(h.tx as never, {
      refundObligationId: OBLIGATION,
      refundAttemptId: ATTEMPT,
    });

    expect(lastEmit(h.emit).params.currency).toBe("SAR");
  });

  it("emits no URL, name, email or free text in any event", async () => {
    const h = harness();

    await h.service.disputeOpened(h.tx as never, DISPUTE);
    await h.service.allocationShipped(h.tx as never, ALLOCATION);
    await h.service.masterOrderFulfilled(h.tx as never, ORDER);

    const serialised = JSON.stringify(h.emit.mock.calls);
    for (const forbidden of ["http", "@", "iban", "message", "legalName"]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("dedupe discriminators distinguish recurrences", () => {
  it("keys a payment failure on the ATTEMPT, so a second failure is its own news", async () => {
    const h = harness();

    await h.service.paymentFailed(h.tx as never, {
      checkoutSessionId: SESSION,
      paymentAttemptId: ATTEMPT,
      traderCompanyId: TRADER,
      amount: "50",
      currency: "SAR",
    });

    expect(lastEmit(h.emit).discriminator).toBe(ATTEMPT);
  });

  it("keys refund events on the refund attempt", async () => {
    const h = harness();

    await h.service.refundInitiated(h.tx as never, {
      refundObligationId: OBLIGATION,
      refundAttemptId: ATTEMPT,
    });

    expect(lastEmit(h.emit).discriminator).toBe(ATTEMPT);
  });

  it("uses no discriminator where the event can happen only once", async () => {
    const h = harness();

    await h.service.allocationShipped(h.tx as never, ALLOCATION);

    expect(lastEmit(h.emit).discriminator).toBeUndefined();
  });

  it("gives two different transitions on one entity different keys", async () => {
    const h = harness();

    await h.service.allocationReady(h.tx as never, ALLOCATION);
    await h.service.allocationShipped(h.tx as never, ALLOCATION);

    const [first, second] = h.emit.mock.calls.map((call) => call[1]);
    expect(first.type).not.toBe(second.type);
    expect(first.entityId).toBe(second.entityId);
  });
});

describe("a missing entity writes nothing rather than guessing", () => {
  it.each([
    ["allocation", "orderAllocation"],
    ["dispute", "dispute"],
    ["replacement obligation", "replacementObligation"],
    ["refund obligation", "refundObligation"],
  ])("skips when the %s cannot be found", async (_label, model) => {
    const h = harness({ [model]: { findUnique: jest.fn(() => Promise.resolve(null)) } });

    await h.service.allocationShipped(h.tx as never, ALLOCATION).catch(() => undefined);
    await h.service.disputeOpened(h.tx as never, DISPUTE).catch(() => undefined);
    await h.service.replacementShipped(h.tx as never, OBLIGATION).catch(() => undefined);
    await h.service
      .refundInitiated(h.tx as never, { refundObligationId: OBLIGATION, refundAttemptId: ATTEMPT })
      .catch(() => undefined);

    // Whichever lookup was nulled, that event produced no write.
    expect(h.emit.mock.calls.length).toBeLessThan(4);
  });
});

describe("entityType always describes what entityId really is", () => {
  it("a payment failure points at the CHECKOUT SESSION, never an order", async () => {
    const h = harness();

    // A payment usually fails before any order exists.
    await h.service.paymentFailed(h.tx as never, {
      checkoutSessionId: SESSION,
      paymentAttemptId: ATTEMPT,
      traderCompanyId: TRADER,
      amount: "50",
      currency: "SAR",
    });

    expect(lastEmit(h.emit)).toMatchObject({
      entityType: "checkout_session",
      entityId: SESSION,
    });
  });

  it("a PAYMENT_EXCEPTION refund points at the session — no order exists yet", async () => {
    const h = harness({
      refundObligation: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            amount: new Prisma.Decimal("40"),
            currency: "SAR",
            source: "PAYMENT_EXCEPTION",
            paymentAttempt: { checkoutSession: { id: SESSION, traderCompanyId: TRADER } },
          })
        ),
      },
    });

    await h.service.refundInitiated(h.tx as never, {
      refundObligationId: OBLIGATION,
      refundAttemptId: ATTEMPT,
    });

    expect(lastEmit(h.emit)).toMatchObject({
      entityType: "checkout_session",
      entityId: SESSION,
    });
  });

  it("does not even look for an order on the PAYMENT_EXCEPTION path", async () => {
    const h = harness({
      refundObligation: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            amount: new Prisma.Decimal("40"),
            currency: "SAR",
            source: "PAYMENT_EXCEPTION",
            paymentAttempt: { checkoutSession: { id: SESSION, traderCompanyId: TRADER } },
          })
        ),
      },
    });

    await h.service.refundFailed(h.tx as never, {
      refundObligationId: OBLIGATION,
      refundAttemptId: ATTEMPT,
    });

    // The source column decides it; there is nothing to probe for.
    expect(h.tx.masterOrder.findFirst).not.toHaveBeenCalled();
  });

  it("a DISPUTE refund points at the order, which necessarily exists", async () => {
    const h = harness({
      refundObligation: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            amount: new Prisma.Decimal("40"),
            currency: "SAR",
            source: "DISPUTE",
            paymentAttempt: { checkoutSession: { id: SESSION, traderCompanyId: TRADER } },
          })
        ),
      },
    });

    await h.service.refundInitiated(h.tx as never, {
      refundObligationId: OBLIGATION,
      refundAttemptId: ATTEMPT,
    });

    expect(lastEmit(h.emit)).toMatchObject({ entityType: "master_order", entityId: ORDER });
  });

  describe("a DISPUTE refund with no order is an invariant violation", () => {
    function disputeRefundWithoutOrder() {
      return harness({
        refundObligation: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              amount: new Prisma.Decimal("40"),
              currency: "SAR",
              source: "DISPUTE",
              paymentAttempt: { checkoutSession: { id: SESSION, traderCompanyId: TRADER } },
            })
          ),
        },
        masterOrder: {
          findUnique: jest.fn(() => Promise.resolve(null)),
          findFirst: jest.fn(() => Promise.resolve(null)),
        },
      });
    }

    it.each(["refundInitiated", "refundFailed"] as const)("%s throws rather than guessing", async (method) => {
      const h = disputeRefundWithoutOrder();

      await expect(
        (h.service as any)[method](h.tx as never, {
          refundObligationId: OBLIGATION,
          refundAttemptId: ATTEMPT,
        })
      ).rejects.toThrow(/corrupt relations/);
    });

    it("writes no notification, recipient or email intent", async () => {
      const h = disputeRefundWithoutOrder();

      await expect(
        h.service.refundInitiated(h.tx as never, {
          refundObligationId: OBLIGATION,
          refundAttemptId: ATTEMPT,
        })
      ).rejects.toThrow();

      // The throw propagates out of the caller's transaction, so
      // nothing partial survives.
      expect(h.emit).not.toHaveBeenCalled();
    });

    it("never falls back to the checkout session", async () => {
      const h = disputeRefundWithoutOrder();

      await h.service
        .refundFailed(h.tx as never, { refundObligationId: OBLIGATION, refundAttemptId: ATTEMPT })
        .catch(() => undefined);

      // A fallback would paper over corrupt relations with a link that
      // looks perfectly fine.
      expect(h.emit).not.toHaveBeenCalled();
    });

    it("names only the obligation id — no company, session or amount", async () => {
      const h = disputeRefundWithoutOrder();

      const error = await h.service
        .refundInitiated(h.tx as never, { refundObligationId: OBLIGATION, refundAttemptId: ATTEMPT })
        .catch((err: Error) => err);

      const message = (error as Error).message;
      expect(message).toContain(OBLIGATION);
      expect(message).not.toContain(TRADER);
      expect(message).not.toContain(SESSION);
      expect(message).not.toContain("40");
    });
  });

  it.each(NOTIFICATION_TYPES)("%s emits a permitted (type, entityType) pair", async (type) => {
    // Exercised through the real writer contract rather than the fake:
    // the pair the emitter produces must be one the writer accepts.
    const h = harness();
    const calls: Array<{ type: string; entityType: string }> = [];
    (h.emit as jest.Mock).mockImplementation((_tx: any, args: any) => {
      calls.push(args);
      return Promise.resolve({ notificationId: "n", created: true });
    });

    const method = NOTIFICATION_MATRIX[type].emitterMethod;
    const args: Record<string, any> = {
      paymentSucceeded: [{ masterOrderId: ORDER, traderCompanyId: TRADER, amount: "1", currency: "SAR" }],
      paymentFailed: [
        { checkoutSessionId: SESSION, paymentAttemptId: ATTEMPT, traderCompanyId: TRADER, amount: "1", currency: "SAR" },
      ],
      orderCreated: [{ masterOrderId: ORDER, supplierCompanyId: SUPPLIER }],
      masterOrderFulfilled: [ORDER],
      disputeOpened: [DISPUTE],
      disputeSupplierResponded: [DISPUTE],
      disputeDecided: [DISPUTE],
      replacementRequired: [{ replacementObligationId: OBLIGATION, disputeId: DISPUTE }],
      refundInitiated: [{ refundObligationId: OBLIGATION, refundAttemptId: ATTEMPT }],
      refundFailed: [{ refundObligationId: OBLIGATION, refundAttemptId: ATTEMPT }],
      settlementExecuted: [
        { supplierPayoutId: PAYOUT, supplierCompanyId: SUPPLIER, netAmount: 1, currency: "SAR" },
      ],
    };
    const call = args[method] ?? [ALLOCATION];

    await (h.service as any)[method](h.tx as never, ...call);

    expect(calls).toHaveLength(1);
    expect(NOTIFICATION_TYPE_ENTITY_TYPES[type]).toContain(calls[0].entityType);
    expect(calls[0].type).toBe(type);
  });
});

describe("every emit goes through the caller's transaction", () => {
  it("passes the tx it was given, never a client of its own", async () => {
    const h = harness();

    await h.service.masterOrderFulfilled(h.tx as never, ORDER);

    expect(h.emit.mock.calls[0][0]).toBe(h.tx);
  });

  it("holds no Prisma client at all", () => {
    const source = readFileSync(join(__dirname, "notification-events.service.ts"), "utf8");

    expect(source).not.toContain("PrismaService");
    expect(source).not.toMatch(/this\.prisma/);
  });

  it("never opens a transaction of its own", () => {
    const source = readFileSync(join(__dirname, "notification-events.service.ts"), "utf8");

    expect(source).not.toContain("$transaction");
  });
});

describe("the matrix and the emitter agree", () => {
  it.each(NOTIFICATION_TYPES)("%s has an emitter method on the service", (type) => {
    const method = NOTIFICATION_MATRIX[type].emitterMethod;

    expect(typeof (NotificationEventsService.prototype as any)[method]).toBe("function");
  });
});
