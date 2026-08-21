import { PrismaClient } from "@prisma/client";
import { MAX_ATTEMPTS, RELAY_SUPPORTED_EVENT_TYPES } from "@platform/email";
import {
  claimBatch,
  databaseNow,
  runClaimPass,
  settleFailed,
  settlePublished,
  settleRetry,
  terminaliseExhausted,
} from "../src/outbox/claim";

/**
 * STATUS: WRITTEN — NOT EXECUTED — STATUS UNKNOWN.
 *
 * These require a real PostgreSQL with migration 89 applied. Port 5432
 * is closed on the development machine, so none of them has ever run;
 * they are expected to execute for the first time in CI.
 *
 * They cover what the unit tests structurally CANNOT: the behaviour of
 * `FOR UPDATE SKIP LOCKED` under concurrency, lease expiry against the
 * database clock, the all-or-none CHECK constraint, and the row counts
 * that make a superseded settlement a no-op.
 */

const prisma = new PrismaClient();
const SUPPORTED = RELAY_SUPPORTED_EVENT_TYPES[0];
const LEGACY = "CHECKOUT_LOCK_EXPIRED";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    notificationId: "11111111-1111-1111-1111-111111111111",
    recipientUserId: "22222222-2222-2222-2222-222222222222",
    template: "ORDER_CREATED",
    params: {},
    ...overrides,
  };
}

async function seed(fields: {
  eventType?: string;
  status?: "PENDING" | "PROCESSING" | "PUBLISHED" | "FAILED";
  attempts?: number;
  lockedUntilOffsetSeconds?: number;
  nextAttemptOffsetSeconds?: number;
}): Promise<string> {
  const eventType = fields.eventType ?? SUPPORTED;
  const status = fields.status ?? "PENDING";
  const attempts = fields.attempts ?? 0;

  // Raw insert: a PROCESSING row must carry a full lease to satisfy the
  // CHECK constraint, and Prisma's fluent API cannot emit now().
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO outbox_events (
      event_type, payload, status, attempts,
      locked_at, locked_until, locked_by, claim_token, next_attempt_at
    )
    VALUES (
      ${eventType},
      ${JSON.stringify(payload())}::jsonb,
      ${status}::"OutboxStatus",
      ${attempts},
      CASE WHEN ${status} = 'PROCESSING' THEN now() ELSE NULL END,
      CASE WHEN ${status} = 'PROCESSING'
           THEN now() + make_interval(secs => ${fields.lockedUntilOffsetSeconds ?? -60})
           ELSE NULL END,
      CASE WHEN ${status} = 'PROCESSING' THEN 'seed-worker' ELSE NULL END,
      CASE WHEN ${status} = 'PROCESSING' THEN gen_random_uuid() ELSE NULL END,
      CASE WHEN ${fields.nextAttemptOffsetSeconds ?? null}::int IS NULL THEN NULL
           ELSE now() + make_interval(secs => ${fields.nextAttemptOffsetSeconds ?? 0}) END
    )
    RETURNING id
  `;
  return rows[0].id;
}

async function read(id: string) {
  return prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM outbox_events WHERE event_type IN (${SUPPORTED}, ${LEGACY})`;
});

describe("attempt budget and terminalisation", () => {
  it("reclaims an expired PROCESSING row at attempts = 7 as attempt 8", async () => {
    const id = await seed({ status: "PROCESSING", attempts: MAX_ATTEMPTS - 1 });

    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });

    expect(claimed.map((row) => row.id)).toContain(id);
    expect((await read(id)).attempts).toBe(MAX_ATTEMPTS);
  });

  it("retires an expired PROCESSING row at attempts = 8 without claiming it", async () => {
    const id = await seed({ status: "PROCESSING", attempts: MAX_ATTEMPTS });

    const { terminalised, claimed } = await runClaimPass(prisma, { lockedBy: "w1" });

    expect(terminalised.map((row) => row.id)).toContain(id);
    expect(claimed.map((row) => row.id)).not.toContain(id);

    const row = await read(id);
    expect(row.status).toBe("FAILED");
    expect(row.errorClass).toBe("ATTEMPTS_EXHAUSTED");
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.publishedAt).toBeNull();
  });

  it("retires a PENDING row that has already spent its budget", async () => {
    const id = await seed({ status: "PENDING", attempts: MAX_ATTEMPTS });

    await runClaimPass(prisma, { lockedBy: "w1" });

    expect((await read(id)).status).toBe("FAILED");
  });

  it("clears every lease field when it retires a row", async () => {
    const id = await seed({ status: "PROCESSING", attempts: MAX_ATTEMPTS });

    await runClaimPass(prisma, { lockedBy: "w1" });
    const row = await read(id);

    expect(row.lockedAt).toBeNull();
    expect(row.lockedUntil).toBeNull();
    expect(row.lockedBy).toBeNull();
    expect(row.claimToken).toBeNull();
    expect(row.nextAttemptAt).toBeNull();
  });

  it("leaves no supported row expired-PROCESSING at max attempts after a pass", async () => {
    await seed({ status: "PROCESSING", attempts: MAX_ATTEMPTS });
    await seed({ status: "PROCESSING", attempts: MAX_ATTEMPTS });

    await runClaimPass(prisma, { lockedBy: "w1" });

    const stuck = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM outbox_events
      WHERE event_type = ${SUPPORTED}
        AND status = 'PROCESSING'
        AND locked_until < now()
        AND attempts >= ${MAX_ATTEMPTS}
    `;
    expect(Number(stuck[0].count)).toBe(0);
  });

  it("does not touch a live lease that still has attempts left", async () => {
    const id = await seed({
      status: "PROCESSING",
      attempts: 1,
      lockedUntilOffsetSeconds: 600,
    });

    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });

    expect(claimed.map((row) => row.id)).not.toContain(id);
    expect((await read(id)).attempts).toBe(1);
  });
});

describe("legacy event types are invisible", () => {
  it("never claims a legacy row", async () => {
    const id = await seed({ eventType: LEGACY, status: "PENDING", attempts: 0 });

    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });

    expect(claimed.map((row) => row.id)).not.toContain(id);
  });

  it("never terminalises a legacy row, even at attempts = 8", async () => {
    const id = await seed({ eventType: LEGACY, status: "PENDING", attempts: MAX_ATTEMPTS });

    await runClaimPass(prisma, { lockedBy: "w1" });
    const row = await read(id);

    expect(row.status).toBe("PENDING");
    expect(row.errorClass).toBeNull();
    expect(row.failedAt).toBeNull();
  });

  it("leaves every new column NULL on a legacy row", async () => {
    const id = await seed({ eventType: LEGACY, status: "PENDING" });

    await runClaimPass(prisma, { lockedBy: "w1" });
    const row = await read(id);

    expect(row.nextAttemptAt).toBeNull();
    expect(row.lockedAt).toBeNull();
    expect(row.lockedUntil).toBeNull();
    expect(row.lockedBy).toBeNull();
    expect(row.claimToken).toBeNull();
    expect(row.errorClass).toBeNull();
    expect(row.failedAt).toBeNull();
  });
});

describe("backoff defers a claim", () => {
  it("skips a PENDING row whose next_attempt_at is in the future", async () => {
    const id = await seed({ status: "PENDING", nextAttemptOffsetSeconds: 3600 });

    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });

    expect(claimed.map((row) => row.id)).not.toContain(id);
  });

  it("claims once the deferral has elapsed", async () => {
    const id = await seed({ status: "PENDING", nextAttemptOffsetSeconds: -1 });

    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });

    expect(claimed.map((row) => row.id)).toContain(id);
  });
});

describe("two workers never claim the same row", () => {
  it("splits a batch disjointly under SKIP LOCKED", async () => {
    const other = new PrismaClient();
    try {
      await seed({});
      await seed({});

      const [a, b] = await Promise.all([
        runClaimPass(prisma, { lockedBy: "w1" }),
        runClaimPass(other, { lockedBy: "w2" }),
      ]);

      const ids = [...a.claimed, ...b.claimed].map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      await other.$disconnect();
    }
  });

  it("issues a distinct claim token per row", async () => {
    await seed({});
    await seed({});

    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });
    const tokens = claimed.map((row) => row.claimToken);

    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("settlement is guarded by the claim token", () => {
  it("publishes the row that holds the current token", async () => {
    await seed({});
    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });
    const row = claimed[0];

    const affected = await settlePublished(prisma, row.id, row.claimToken);

    expect(affected).toBe(1);
    const settled = await read(row.id);
    expect(settled.status).toBe("PUBLISHED");
    expect(settled.publishedAt).not.toBeNull();
    expect(settled.claimToken).toBeNull();
    expect(settled.lockedAt).toBeNull();
    expect(settled.lockedUntil).toBeNull();
    expect(settled.lockedBy).toBeNull();
  });

  it("matches ZERO rows for a stale token", async () => {
    await seed({});
    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });
    const row = claimed[0];

    const stale = "33333333-3333-3333-3333-333333333333";
    const affected = await settlePublished(prisma, row.id, stale);

    expect(affected).toBe(0);
    expect((await read(row.id)).status).toBe("PROCESSING");
  });

  it("cannot settle a row that was re-claimed after its lease lapsed", async () => {
    await seed({ status: "PROCESSING", attempts: 1 });
    const first = (await runClaimPass(prisma, { lockedBy: "w1" })).claimed[0];

    // Expire the lease, then let a second worker take it.
    await prisma.$executeRaw`
      UPDATE outbox_events SET locked_until = now() - make_interval(secs => 1) WHERE id = ${first.id}::uuid
    `;
    const second = (await runClaimPass(prisma, { lockedBy: "w2" })).claimed[0];

    expect(await settlePublished(prisma, first.id, first.claimToken)).toBe(0);
    expect(await settlePublished(prisma, second.id, second.claimToken)).toBe(1);
  });

  it("returns a retried row to PENDING with a future deferral", async () => {
    await seed({});
    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });
    const row = claimed[0];
    const now = await databaseNow(prisma);

    await settleRetry(prisma, row.id, row.claimToken, new Date(now.getTime() + 60_000), "PROVIDER_5XX");
    const settled = await read(row.id);

    expect(settled.status).toBe("PENDING");
    expect(settled.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());
    expect(settled.errorClass).toBe("PROVIDER_5XX");
    expect(settled.failedAt).toBeNull();
    expect(settled.claimToken).toBeNull();
  });

  it("dead-letters a row with a classified failure", async () => {
    await seed({});
    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });
    const row = claimed[0];

    await settleFailed(prisma, row.id, row.claimToken, "PAYLOAD_INVALID");
    const settled = await read(row.id);

    expect(settled.status).toBe("FAILED");
    expect(settled.errorClass).toBe("PAYLOAD_INVALID");
    expect(settled.failedAt).not.toBeNull();
    expect(settled.nextAttemptAt).toBeNull();
    expect(settled.publishedAt).toBeNull();
  });

  it("never writes last_error", async () => {
    await seed({});
    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });

    await settleFailed(prisma, claimed[0].id, claimed[0].claimToken, "UNKNOWN");

    expect((await read(claimed[0].id)).lastError).toBeNull();
  });

  it("does not resend a row already PUBLISHED", async () => {
    await seed({});
    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });
    await settlePublished(prisma, claimed[0].id, claimed[0].claimToken);

    const second = await runClaimPass(prisma, { lockedBy: "w1" });

    expect(second.claimed).toHaveLength(0);
  });
});

describe("the all-or-none lease CHECK constraint", () => {
  it("rejects a PROCESSING row with a partial lease", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO outbox_events (event_type, payload, status, attempts, locked_at)
        VALUES (${SUPPORTED}, '{}'::jsonb, 'PROCESSING'::"OutboxStatus", 0, now())
      `
    ).rejects.toThrow();
  });

  it("rejects a non-PROCESSING row carrying lease metadata", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO outbox_events (event_type, payload, status, attempts, claim_token)
        VALUES (${SUPPORTED}, '{}'::jsonb, 'PENDING'::"OutboxStatus", 0, gen_random_uuid())
      `
    ).rejects.toThrow();
  });

  it("accepts a PENDING row with no lease metadata", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO outbox_events (event_type, payload, status, attempts)
        VALUES (${SUPPORTED}, '{}'::jsonb, 'PENDING'::"OutboxStatus", 0)
      `
    ).resolves.toBeGreaterThan(0);
  });

  it("accepts a fully leased PROCESSING row", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO outbox_events (
          event_type, payload, status, attempts, locked_at, locked_until, locked_by, claim_token
        )
        VALUES (
          ${SUPPORTED}, '{}'::jsonb, 'PROCESSING'::"OutboxStatus", 0,
          now(), now() + make_interval(secs => 120), 'w1', gen_random_uuid()
        )
      `
    ).resolves.toBeGreaterThan(0);
  });
});

describe("the claim reads the database clock, not the process clock", () => {
  it("stamps locked_at from now() even when the client clock is skewed", async () => {
    const before = await databaseNow(prisma);
    await seed({});

    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1" });
    const row = await read(claimed[0].id);
    const after = await databaseNow(prisma);

    expect(row.lockedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row.lockedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("sets locked_until a full lease ahead of locked_at", async () => {
    await seed({});

    const { claimed } = await runClaimPass(prisma, { lockedBy: "w1", leaseSeconds: 120 });
    const row = await read(claimed[0].id);

    const spanMs = row.lockedUntil!.getTime() - row.lockedAt!.getTime();
    expect(spanMs).toBeGreaterThanOrEqual(119_000);
    expect(spanMs).toBeLessThanOrEqual(121_000);
  });
});

describe("direct primitives", () => {
  it("terminaliseExhausted returns the ids it retired", async () => {
    const id = await seed({ status: "PENDING", attempts: MAX_ATTEMPTS });

    const retired = await prisma.$transaction((tx) => terminaliseExhausted(tx));

    expect(retired.map((row) => row.id)).toContain(id);
  });

  it("claimBatch honours an explicit batch size", async () => {
    await seed({});
    await seed({});
    await seed({});

    const claimed = await prisma.$transaction((tx) =>
      claimBatch(tx, { lockedBy: "w1", batchSize: 2 })
    );

    expect(claimed).toHaveLength(2);
  });
});
