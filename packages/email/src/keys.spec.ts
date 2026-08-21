import { buildCreationIdempotencyKey, buildProviderDeliveryKey } from "./keys";

const NOTIFICATION = "11111111-1111-1111-1111-111111111111";
const RECIPIENT = "22222222-2222-2222-2222-222222222222";
const OUTBOX = "33333333-3333-3333-3333-333333333333";

describe("the creation key", () => {
  it("has the agreed shape", () => {
    expect(buildCreationIdempotencyKey(NOTIFICATION, RECIPIENT)).toBe(
      `email:v1:${NOTIFICATION}:${RECIPIENT}`
    );
  });

  it("is deterministic — the same pair always produces the same key", () => {
    expect(buildCreationIdempotencyKey(NOTIFICATION, RECIPIENT)).toBe(
      buildCreationIdempotencyKey(NOTIFICATION, RECIPIENT)
    );
  });

  it("distinguishes recipients, so one notification can reach several users", () => {
    const a = buildCreationIdempotencyKey(NOTIFICATION, RECIPIENT);
    const b = buildCreationIdempotencyKey(NOTIFICATION, "44444444-4444-4444-4444-444444444444");

    expect(a).not.toBe(b);
  });

  it("distinguishes notifications for the same recipient", () => {
    const a = buildCreationIdempotencyKey(NOTIFICATION, RECIPIENT);
    const b = buildCreationIdempotencyKey("55555555-5555-5555-5555-555555555555", RECIPIENT);

    expect(a).not.toBe(b);
  });

  it("is versioned, so a future key scheme cannot collide with this one", () => {
    expect(buildCreationIdempotencyKey(NOTIFICATION, RECIPIENT).startsWith("email:v1:")).toBe(true);
  });
});

describe("the delivery key", () => {
  it("has the agreed shape", () => {
    expect(buildProviderDeliveryKey(OUTBOX)).toBe(`outbox:${OUTBOX}`);
  });

  it("is stable across attempts — the whole point after a crash", () => {
    const first = buildProviderDeliveryKey(OUTBOX);
    const retry = buildProviderDeliveryKey(OUTBOX);

    expect(retry).toBe(first);
  });

  it("keys on the OUTBOX ROW, not the notification", () => {
    // One notification can produce a row per recipient. Keying delivery
    // on the notification would make a provider suppress every
    // recipient after the first.
    expect(buildProviderDeliveryKey(OUTBOX)).not.toContain(NOTIFICATION);
  });

  it("differs from the creation key namespace", () => {
    expect(buildProviderDeliveryKey(OUTBOX).startsWith("email:")).toBe(false);
  });
});

describe("inputs that would make a key ambiguous are refused", () => {
  it.each([
    ["an empty notificationId", "", RECIPIENT],
    ["an empty recipientUserId", NOTIFICATION, ""],
  ])("rejects %s", (_label, notification, recipient) => {
    expect(() => buildCreationIdempotencyKey(notification, recipient)).toThrow();
  });

  it("rejects a separator inside an identifier", () => {
    // Without this, ("a:b", "c") and ("a", "b:c") would compose to one
    // string and the unique index would reject a legitimate second row.
    expect(() => buildCreationIdempotencyKey("a:b", "c")).toThrow(/separator/);
  });

  it("rejects an empty outboxEventId", () => {
    expect(() => buildProviderDeliveryKey("")).toThrow();
  });

  it("names the offending field so the failure is actionable", () => {
    expect(() => buildCreationIdempotencyKey("", RECIPIENT)).toThrow(/notificationId/);
    expect(() => buildCreationIdempotencyKey(NOTIFICATION, "")).toThrow(/recipientUserId/);
  });
});
