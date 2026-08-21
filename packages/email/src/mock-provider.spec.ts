import { MockEmailProvider, type MockEmailLogRecord } from "./mock-provider";
import type { SendEmailCommand } from "./provider";

const SENSITIVE: SendEmailCommand = {
  to: "buyer@example.com",
  subject: "Your payment was received",
  htmlBody: "<p>Payment for order 1200 SAR is confirmed.</p>",
  textBody: "Payment for order 1200 SAR is confirmed.",
  idempotencyKey: "outbox:11111111-1111-1111-1111-111111111111",
};

const CONTEXT = {
  template: "PAYMENT_SUCCEEDED",
  recipientUserId: "22222222-2222-2222-2222-222222222222",
  outboxEventId: "11111111-1111-1111-1111-111111111111",
};

function capture() {
  const records: MockEmailLogRecord[] = [];
  const provider = new MockEmailProvider((record) => records.push(record));
  return { provider, records };
}

describe("the mock provider logs a closed record", () => {
  it("emits exactly four keys, and those four", async () => {
    const { provider, records } = capture();

    await provider.withContext(CONTEXT).sendEmail(SENSITIVE);

    // Exact key equality, not "does not contain": a new field added
    // carelessly must fail this test rather than slip through a
    // substring check.
    expect(Object.keys(records[0]).sort()).toEqual(
      ["outboxEventId", "providerMode", "recipientUserId", "template"].sort()
    );
  });

  it("records the correlation identifiers and the provider mode", async () => {
    const { provider, records } = capture();

    await provider.withContext(CONTEXT).sendEmail(SENSITIVE);

    expect(records[0]).toEqual({
      template: "PAYMENT_SUCCEEDED",
      recipientUserId: CONTEXT.recipientUserId,
      outboxEventId: CONTEXT.outboxEventId,
      providerMode: "mock",
    });
  });

  it.each([
    ["the recipient address", "buyer@example.com"],
    ["the subject", "Your payment was received"],
    ["the html body", "<p>Payment"],
    ["the text body", "Payment for order"],
    ["an amount", "1200"],
  ])("never records %s", async (_label, fragment) => {
    const { provider, records } = capture();

    await provider.withContext(CONTEXT).sendEmail(SENSITIVE);

    expect(JSON.stringify(records[0])).not.toContain(fragment);
  });

  it("does not record the idempotency key either", async () => {
    const { provider, records } = capture();

    await provider.withContext(CONTEXT).sendEmail(SENSITIVE);

    expect(JSON.stringify(records[0])).not.toContain("outbox:");
  });
});

describe("context handling", () => {
  it("falls back to 'unknown' for a direct send that supplied no context", async () => {
    const { provider, records } = capture();

    // Password reset and email verification take this path: no
    // notification, no outbox row, no template id in the registry.
    await provider.sendEmail(SENSITIVE);

    expect(records[0]).toEqual({
      template: "unknown",
      recipientUserId: "unknown",
      outboxEventId: "unknown",
      providerMode: "mock",
    });
  });

  it("does not leak one send's context into the next", async () => {
    const { provider, records } = capture();

    await provider.withContext(CONTEXT).sendEmail(SENSITIVE);
    await provider.sendEmail(SENSITIVE);

    expect(records[1].outboxEventId).toBe("unknown");
  });
});

describe("abort handling", () => {
  it("refuses an already-aborted send instead of logging a phantom one", async () => {
    const { provider, records } = capture();
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.withContext(CONTEXT).sendEmail({ ...SENSITIVE, signal: controller.signal })
    ).rejects.toThrow();

    expect(records).toHaveLength(0);
  });

  it("sends normally when the signal is live", async () => {
    const { provider, records } = capture();
    const controller = new AbortController();

    await provider.withContext(CONTEXT).sendEmail({ ...SENSITIVE, signal: controller.signal });

    expect(records).toHaveLength(1);
  });
});

describe("honesty about delivery", () => {
  it("reports its mode as mock", () => {
    expect(new MockEmailProvider().mode).toBe("mock");
  });

  it("declares delivery simulated — nothing leaves the process", () => {
    expect(new MockEmailProvider().deliveryIsSimulated).toBe(true);
  });

  it("works without a sink, so a caller cannot be forced into logging", async () => {
    await expect(new MockEmailProvider().sendEmail(SENSITIVE)).resolves.toBeUndefined();
  });
});
