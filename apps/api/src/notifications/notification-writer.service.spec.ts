import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMAIL_EMITTING_NOTIFICATION_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_ENTITY_TYPES,
  NOTIFICATION_TYPE_PARAM_KEYS,
  emitsEmail,
  type NotificationType,
} from "@platform/types";
import {
  EMAIL_TEMPLATE_IDS,
  buildCreationIdempotencyKey,
  validateEmailNotificationV1,
} from "@platform/email";
import { NotificationWriterService, buildDedupeKey } from "./notification-writer.service";

const NOTIFICATION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ENTITY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const USER_A = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const USER_B = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

interface Captured {
  sql: string;
  values: unknown[];
}

/**
 * A fake transaction client that records the SQL and answers each
 * INSERT with a configurable result, so the writer's ORDERING and its
 * conflict handling can be asserted without a database.
 */
function harness(options: { notificationExists?: boolean; users?: string[] } = {}) {
  const calls: Captured[] = [];
  const users = options.users ?? [USER_A, USER_B];

  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.raw.join(" ? ").replace(/\s+/g, " ").trim();
      calls.push({ sql, values });

      if (sql.includes("INSERT INTO notifications")) {
        return Promise.resolve(options.notificationExists ? [] : [{ id: NOTIFICATION_ID }]);
      }
      if (sql.includes("INSERT INTO notification_recipients")) {
        return Promise.resolve(users.map((id) => ({ id })));
      }
      if (sql.includes("INSERT INTO outbox_events")) {
        return Promise.resolve(users.map((id) => ({ id })));
      }
      return Promise.resolve([]);
    }),
    user: { findMany: jest.fn(() => Promise.resolve(users.map((id) => ({ id })))) },
  };

  return { tx, calls, service: new NotificationWriterService() };
}

/**
 * Builds a valid input for a type.
 *
 * `entityType` defaults to the type's OWN first permitted value rather
 * than a fixed one: the writer now rejects a mismatched pair, so a
 * fixture that always said `master_order` would fail for every
 * allocation and dispute event — correctly.
 */
const input = (overrides: Record<string, unknown> = {}) => {
  const type = (overrides.type as NotificationType) ?? "ORDER_CREATED";
  return {
    companyId: COMPANY_ID,
    type,
    entityType: NOTIFICATION_TYPE_ENTITY_TYPES[type][0],
    entityId: ENTITY_ID,
    params: { orderId: ENTITY_ID },
    ...overrides,
  };
};

describe("the email-emitting split matches the matrix", () => {
  it("marks exactly 13 of the 18 types as email-emitting", () => {
    expect(NOTIFICATION_TYPES).toHaveLength(18);
    expect(EMAIL_EMITTING_NOTIFICATION_TYPES).toHaveLength(13);
  });

  it("leaves exactly 5 as in-app only", () => {
    const inAppOnly = NOTIFICATION_TYPES.filter((type) => !emitsEmail(type));

    expect(inAppOnly.sort()).toEqual(
      [
        "ALLOCATION_PREPARATION_STARTED",
        "ALLOCATION_READY",
        "ALLOCATION_DELIVERED",
        "REPLACEMENT_SHIPPED",
        "REPLACEMENT_DELIVERED",
      ].sort()
    );
  });

  it("names every email-emitting type identically to an email template id", () => {
    // This is what lets the writer map type -> template directly
    // instead of maintaining a translation table that could drift.
    for (const type of EMAIL_EMITTING_NOTIFICATION_TYPES) {
      expect(EMAIL_TEMPLATE_IDS).toContain(type);
    }
    expect([...EMAIL_EMITTING_NOTIFICATION_TYPES].sort()).toEqual([...EMAIL_TEMPLATE_IDS].sort());
  });

  it.each(EMAIL_EMITTING_NOTIFICATION_TYPES)("%s writes an email intent", async (type) => {
    const h = harness();
    const params = Object.fromEntries(NOTIFICATION_TYPE_PARAM_KEYS[type].map((k) => [k, "x"]));

    const result = await h.service.emit(h.tx as never, input({ type, params }));

    expect(result.emailIntentsCreated).toBe(2);
  });

  it.each([
    "ALLOCATION_PREPARATION_STARTED",
    "ALLOCATION_READY",
    "ALLOCATION_DELIVERED",
    "REPLACEMENT_SHIPPED",
    "REPLACEMENT_DELIVERED",
  ] as const)("%s writes NO email intent", async (type) => {
    const h = harness();
    const params = Object.fromEntries(NOTIFICATION_TYPE_PARAM_KEYS[type].map((k) => [k, "x"]));

    const result = await h.service.emit(h.tx as never, input({ type, params }));

    expect(result.emailIntentsCreated).toBe(0);
    expect(h.calls.some((c) => c.sql.includes("outbox_events"))).toBe(false);
  });
});

describe("dedupe keys are deterministic", () => {
  it("has the documented shape", () => {
    expect(
      buildDedupeKey({ type: "ORDER_CREATED", entityType: "master_order", entityId: "o-1" })
    ).toBe("ORDER_CREATED:master_order:o-1:");
  });

  it("is stable for identical input", () => {
    const args = { type: "ORDER_CREATED" as const, entityType: "master_order", entityId: "o-1" };

    expect(buildDedupeKey(args)).toBe(buildDedupeKey(args));
  });

  it("distinguishes a discriminator", () => {
    const base = { type: "ALLOCATION_SHIPPED" as const, entityType: "order_allocation", entityId: "a" };

    expect(buildDedupeKey({ ...base, discriminator: "1" })).not.toBe(
      buildDedupeKey({ ...base, discriminator: "2" })
    );
  });

  it("distinguishes type, entity type and entity id", () => {
    const keys = new Set([
      buildDedupeKey({ type: "ORDER_CREATED", entityType: "master_order", entityId: "a" }),
      buildDedupeKey({ type: "PAYMENT_FAILED", entityType: "master_order", entityId: "a" }),
      buildDedupeKey({ type: "ORDER_CREATED", entityType: "dispute", entityId: "a" }),
      buildDedupeKey({ type: "ORDER_CREATED", entityType: "master_order", entityId: "b" }),
    ]);

    expect(keys.size).toBe(4);
  });
});

describe("deduplication is the database's job", () => {
  it("uses ON CONFLICT DO NOTHING on the notification insert", async () => {
    const h = harness();

    await h.service.emit(h.tx as never, input());

    expect(h.calls[0].sql).toContain("ON CONFLICT (dedupe_key) DO NOTHING");
    expect(h.calls[0].sql).toContain("RETURNING id");
  });

  it("never reads before writing — no check-then-insert window", async () => {
    const h = harness();

    await h.service.emit(h.tx as never, input());

    // The FIRST statement is the insert. A prior SELECT would be the
    // race that concurrency walks straight through.
    expect(h.calls[0].sql.startsWith("INSERT INTO notifications")).toBe(true);
  });

  it("creates nothing further when the notification already existed", async () => {
    const h = harness({ notificationExists: true });

    const result = await h.service.emit(h.tx as never, input());

    expect(result).toEqual({
      notificationId: null,
      created: false,
      recipientsCreated: 0,
      emailIntentsCreated: 0,
    });
    expect(h.calls).toHaveLength(1);
  });

  it("does not raise on a duplicate, so the business transaction survives", async () => {
    const h = harness({ notificationExists: true });

    // A unique violation raised here would abort the caller's entire
    // transaction — the wrong outcome for a duplicate notification.
    await expect(h.service.emit(h.tx as never, input())).resolves.toBeDefined();
  });

  it("guards recipients with their own conflict clause", async () => {
    const h = harness();

    await h.service.emit(h.tx as never, input());
    const recipients = h.calls.find((c) => c.sql.includes("notification_recipients"))!;

    expect(recipients.sql).toContain("ON CONFLICT (notification_id, user_id) DO NOTHING");
  });

  it("targets the outbox PARTIAL unique index explicitly", async () => {
    const h = harness();

    await h.service.emit(h.tx as never, input({ type: "PAYMENT_SUCCEEDED", params: {} }));
    const outbox = h.calls.find((c) => c.sql.includes("outbox_events"))!;

    // A bare ON CONFLICT (idempotency_key) would not match the partial
    // index from migration 20260816000500 and would raise instead.
    expect(outbox.sql).toContain(
      "ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING"
    );
  });
});

describe("recipient expansion", () => {
  it("selects only ACTIVE users of the company", async () => {
    const h = harness();

    await h.service.emit(h.tx as never, input());

    expect(h.tx.user.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, status: "ACTIVE" },
      select: { id: true },
    });
  });

  it("creates one recipient per active user", async () => {
    const h = harness({ users: [USER_A, USER_B, "ffffffff-ffff-ffff-ffff-ffffffffffff"] });

    const result = await h.service.emit(h.tx as never, input());

    expect(result.recipientsCreated).toBe(3);
  });

  it("writes nothing further when a company has no active users", async () => {
    const h = harness({ users: [] });

    const result = await h.service.emit(h.tx as never, input({ type: "PAYMENT_SUCCEEDED", params: {} }));

    expect(result.recipientsCreated).toBe(0);
    expect(result.emailIntentsCreated).toBe(0);
    expect(h.calls.some((c) => c.sql.includes("outbox_events"))).toBe(false);
  });
});

describe("the email intent uses the shared contract", () => {
  function outboxCall(calls: Captured[]) {
    return calls.find((c) => c.sql.includes("outbox_events"))!;
  }

  it("keys per (notification, RECIPIENT), so a colleague is not suppressed", async () => {
    const h = harness();

    await h.service.emit(h.tx as never, input({ type: "PAYMENT_SUCCEEDED", params: {} }));
    const keys = outboxCall(h.calls).values.find((v) => Array.isArray(v) && String(v[0]).startsWith("email:v1:")) as string[];

    expect(keys).toEqual([
      buildCreationIdempotencyKey(NOTIFICATION_ID, USER_A),
      buildCreationIdempotencyKey(NOTIFICATION_ID, USER_B),
    ]);
    expect(new Set(keys).size).toBe(2);
  });

  it("emits EMAIL_NOTIFICATION_V1 and nothing else", async () => {
    const h = harness();

    await h.service.emit(h.tx as never, input({ type: "PAYMENT_SUCCEEDED", params: {} }));

    expect(outboxCall(h.calls).values).toContain("EMAIL_NOTIFICATION_V1");
  });

  it("builds a payload the relay's own validator accepts", async () => {
    const h = harness();

    await h.service.emit(
      h.tx as never,
      input({ type: "PAYMENT_SUCCEEDED", params: { orderId: ENTITY_ID, amount: "12.50", currency: "SAR" } })
    );

    const payloads = outboxCall(h.calls).values.find(
      (v) => Array.isArray(v) && String(v[0]).includes('"v":1')
    ) as string[];
    const parsed = JSON.parse(payloads[0]);

    // Round-tripped through the SAME validator the relay uses, so a
    // producer that drifts from the consumer fails here rather than as
    // a PAYLOAD_INVALID dead-letter in production.
    expect(validateEmailNotificationV1(parsed).ok).toBe(true);
  });

  it("carries no email address in the payload", async () => {
    const h = harness();

    await h.service.emit(h.tx as never, input({ type: "PAYMENT_SUCCEEDED", params: {} }));
    const serialised = JSON.stringify(outboxCall(h.calls).values);

    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain("recipientEmail");
  });

  it("names the notification type as the template id", async () => {
    const h = harness();

    await h.service.emit(h.tx as never, input({ type: "DISPUTE_DECIDED", params: { disputeId: "d" } }));
    const payloads = outboxCall(h.calls).values.find(
      (v) => Array.isArray(v) && String(v[0]).includes('"v":1')
    ) as string[];

    expect(JSON.parse(payloads[0]).template).toBe("DISPUTE_DECIDED");
  });
});

describe("entityType must describe what entityId actually is", () => {
  it("rejects a pair the type does not permit, before any statement", async () => {
    const h = harness();

    await expect(
      h.service.emit(
        h.tx as never,
        input({ type: "PAYMENT_FAILED", entityType: "master_order", params: {} })
      )
    ).rejects.toThrow(/may not point at entityType/);
    expect(h.calls).toHaveLength(0);
  });

  it("names the permitted values so the failure is actionable", async () => {
    const h = harness();

    await expect(
      h.service.emit(h.tx as never, input({ type: "DISPUTE_OPENED", entityType: "supplier_payout" }))
    ).rejects.toThrow(/permitted: dispute/);
  });

  it.each(NOTIFICATION_TYPES)("%s accepts each of its own permitted entity types", async (type) => {
    for (const entityType of NOTIFICATION_TYPE_ENTITY_TYPES[type]) {
      const h = harness();
      const params = Object.fromEntries(
        NOTIFICATION_TYPE_PARAM_KEYS[type].map((key) => [key, "x"])
      );

      await expect(
        h.service.emit(h.tx as never, input({ type, entityType, params }))
      ).resolves.toBeDefined();
    }
  });

  it("lets a refund point at an order OR the session it came from", async () => {
    for (const entityType of ["master_order", "checkout_session"] as const) {
      const h = harness();

      await expect(
        h.service.emit(
          h.tx as never,
          input({ type: "REFUND_FAILED", entityType, params: { amount: "1", currency: "SAR" } })
        )
      ).resolves.toBeDefined();
    }
  });

  it("never lets an allocation event claim to be an order", async () => {
    const h = harness();

    await expect(
      h.service.emit(h.tx as never, input({ type: "ALLOCATION_SHIPPED", entityType: "master_order" }))
    ).rejects.toThrow();
  });
});

describe("params are validated before anything is written", () => {
  it("throws without issuing a single statement", async () => {
    const h = harness();

    await expect(
      h.service.emit(h.tx as never, input({ params: { iban: "SA03" } }))
    ).rejects.toThrow(/UNKNOWN_KEY/);
    expect(h.calls).toHaveLength(0);
  });

  it("rejects a param the type does not allow", async () => {
    const h = harness();

    await expect(
      h.service.emit(h.tx as never, input({ type: "SETTLEMENT_EXECUTED", params: { disputeId: "d" } }))
    ).rejects.toThrow(/NOT_ALLOWED_FOR_TYPE/);
  });
});

describe("structural contract of the writer", () => {
  const SOURCE = readFileSync(join(__dirname, "notification-writer.service.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("imports the payload shape and key builder rather than re-deriving them", () => {
    expect(SOURCE).toContain('from "@platform/email"');
    expect(SOURCE).toContain("buildCreationIdempotencyKey");
    expect(SOURCE).toContain("EMAIL_NOTIFICATION_V1");
  });

  it("never hand-builds an email idempotency key", () => {
    expect(SOURCE).not.toMatch(/`email:v1:/);
  });

  it("requires a transaction client — the parameter is not optional", () => {
    expect(SOURCE).toMatch(/tx:\s*Prisma\.TransactionClient,/);
    expect(SOURCE).not.toMatch(/tx\?:\s*Prisma\.TransactionClient/);
  });

  it("writes through the transaction client only, never a bare prisma", () => {
    expect(SOURCE).not.toMatch(/this\.prisma\./);
  });

  it("uses ON CONFLICT everywhere it inserts", () => {
    const inserts = SOURCE.match(/INSERT INTO/g) ?? [];
    const conflicts = SOURCE.match(/ON CONFLICT/g) ?? [];

    expect(inserts.length).toBeGreaterThan(0);
    expect(conflicts).toHaveLength(inserts.length);
  });
});
