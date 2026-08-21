import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_ATTEMPTS, type EmailProvider, type SendEmailCommand } from "@platform/email";
import { runOutboxRelayPass } from "./outbox-relay-processor";

/**
 * The processor exercised end to end against fakes: a fake claim layer,
 * a fake `users` read and a fake provider. What is proved here is the
 * DECISION LOGIC — which failures are terminal, which are retried, what
 * is settled with which class, what is logged, and what the provider is
 * handed. Real database behaviour lives in the integration spec.
 */

const OUTBOX_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NOTIFICATION_ID = "11111111-1111-1111-1111-111111111111";
const RECIPIENT_ID = "22222222-2222-2222-2222-222222222222";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    notificationId: NOTIFICATION_ID,
    recipientUserId: RECIPIENT_ID,
    template: "ORDER_CREATED",
    params: { orderId: "33333333-3333-3333-3333-333333333333" },
    ...overrides,
  };
}

function claimedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: OUTBOX_ID,
    eventType: "EMAIL_NOTIFICATION_V1",
    payload: validPayload(),
    attempts: 1,
    claimToken: "token-1",
    ...overrides,
  };
}

interface Settled {
  kind: "published" | "retry" | "failed";
  id: string;
  claimToken: string;
  errorClass?: string;
  nextAttemptAt?: Date;
}

function harness(options: {
  rows?: ReturnType<typeof claimedRow>[];
  terminalised?: { id: string }[];
  user?: { email: string; status: string } | null;
  send?: (command: SendEmailCommand) => Promise<void>;
  affectedRows?: number;
} = {}) {
  const settled: Settled[] = [];
  const sent: SendEmailCommand[] = [];
  const logs: Record<string, unknown>[] = [];
  const affected = options.affectedRows ?? 1;

  const provider: EmailProvider = {
    mode: "mock",
    sendEmail: async (command) => {
      sent.push(command);
      if (options.send) await options.send(command);
    },
  };

  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    // Claim layer: terminalisation returns first, then the batch.
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.raw.join(" ");
      if (sql.includes("SELECT now()")) {
        return Promise.resolve([{ now: new Date("2026-08-21T00:00:00.000Z") }]);
      }
      // Discriminated by STATEMENT TEXT, not by a bound value:
      // ATTEMPTS_EXHAUSTED is a parameter and never appears in the SQL.
      if (!sql.includes("FOR UPDATE SKIP LOCKED")) {
        return Promise.resolve(options.terminalised ?? []);
      }
      return Promise.resolve(
        (options.rows ?? [claimedRow()]).map((row) => ({
          id: row.id,
          event_type: row.eventType,
          payload: row.payload,
          attempts: row.attempts,
          claim_token: row.claimToken,
        }))
      );
    }),
    $executeRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.raw.join(" ");
      const kind = sql.includes("'PUBLISHED'")
        ? "published"
        : sql.includes("'PENDING'")
          ? "retry"
          : "failed";
      settled.push({
        kind,
        id: values[values.length - 2] as string,
        claimToken: values[values.length - 1] as string,
        // Digits included: PROVIDER_5XX would not match a letters-only
        // pattern, which silently reported `undefined` on first run.
        errorClass: values.find((v) => typeof v === "string" && /^[A-Z0-9_]+$/.test(v)) as string,
        nextAttemptAt: values.find((v) => v instanceof Date) as Date,
      });
      return Promise.resolve(affected);
    }),
    user: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          options.user === undefined ? { email: "buyer@example.com", status: "ACTIVE" } : options.user
        )
      ),
    },
  };

  const logger = {
    info: (obj: Record<string, unknown>) => logs.push(obj),
    warn: (obj: Record<string, unknown>) => logs.push(obj),
    error: (obj: Record<string, unknown>) => logs.push(obj),
  };

  return { prisma, provider, logger, settled, sent, logs };
}

const run = (h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}) =>
  runOutboxRelayPass(
    { prisma: h.prisma as never, provider: h.provider, logger: h.logger as never },
    { lockedBy: "worker-1", random: () => 0.5, ...extra }
  );

describe("a valid payload is sent and published", () => {
  it("publishes on provider acceptance", async () => {
    const h = harness();

    const result = await run(h);

    expect(h.sent).toHaveLength(1);
    expect(h.settled[0].kind).toBe("published");
    expect(result.published).toBe(1);
  });

  it("passes the stable delivery key", async () => {
    const h = harness();

    await run(h);

    expect(h.sent[0].idempotencyKey).toBe(`outbox:${OUTBOX_ID}`);
  });

  it("passes the SAME key on a later attempt of the same row", async () => {
    const first = harness({ rows: [claimedRow({ attempts: 1 })] });
    const retry = harness({ rows: [claimedRow({ attempts: 5 })] });

    await run(first);
    await run(retry);

    expect(retry.sent[0].idempotencyKey).toBe(first.sent[0].idempotencyKey);
  });

  it("resolves the recipient from users, not from the payload", async () => {
    const h = harness();

    await run(h);

    expect(h.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      select: { email: true, status: true },
    });
    expect(h.sent[0].to).toBe("buyer@example.com");
  });

  it("renders a subject and both bodies", async () => {
    const h = harness();

    await run(h);

    expect(h.sent[0].subject.length).toBeGreaterThan(0);
    expect(h.sent[0].htmlBody).toContain("<p>");
    expect(h.sent[0].textBody!.length).toBeGreaterThan(0);
  });

  it("hands the provider an abort signal", async () => {
    const h = harness();

    await run(h);

    expect(h.sent[0].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("terminal outcomes never call the provider", () => {
  it.each([
    ["a malformed payload", { payload: { nope: true } }],
    ["a wrong version", { payload: validPayload({ v: 2 }) }],
    ["an unknown template", { payload: validPayload({ template: "NOT_A_TEMPLATE" }) }],
    ["a param the template rejects", { payload: validPayload({ params: { disputeId: "x" } }) }],
  ])("%s fails with PAYLOAD_INVALID and sends nothing", async (_label, overrides) => {
    const h = harness({ rows: [claimedRow(overrides)] });

    const result = await run(h);

    expect(h.sent).toHaveLength(0);
    expect(h.settled[0]).toMatchObject({ kind: "failed", errorClass: "PAYLOAD_INVALID" });
    expect(result.failed).toBe(1);
  });

  it("fails with RECIPIENT_NOT_FOUND when the user is gone", async () => {
    const h = harness({ user: null });

    await run(h);

    expect(h.sent).toHaveLength(0);
    expect(h.settled[0]).toMatchObject({ kind: "failed", errorClass: "RECIPIENT_NOT_FOUND" });
  });

  it.each(["SUSPENDED", "DISABLED"])("fails with RECIPIENT_INACTIVE for a %s user", async (status) => {
    const h = harness({ user: { email: "x@example.com", status } });

    await run(h);

    expect(h.settled[0]).toMatchObject({ kind: "failed", errorClass: "RECIPIENT_INACTIVE" });
  });

  it("fails with RECIPIENT_NOT_FOUND for an empty address", async () => {
    const h = harness({ user: { email: "", status: "ACTIVE" } });

    await run(h);

    expect(h.settled[0]).toMatchObject({ errorClass: "RECIPIENT_NOT_FOUND" });
  });

  it("dead-letters a rejected recipient without retrying", async () => {
    const h = harness({
      send: async () => {
        throw Object.assign(new Error("x"), { statusCode: 422 });
      },
    });

    await run(h);

    expect(h.settled[0]).toMatchObject({
      kind: "failed",
      errorClass: "PROVIDER_REJECTED_RECIPIENT",
    });
  });
});

describe("retryable failures", () => {
  it.each([
    [429, "PROVIDER_RATE_LIMITED"],
    [503, "PROVIDER_5XX"],
  ])("status %s schedules a retry classed %s", async (status, errorClass) => {
    const h = harness({
      send: async () => {
        throw Object.assign(new Error("x"), { statusCode: status });
      },
    });

    const result = await run(h);

    expect(h.settled[0]).toMatchObject({ kind: "retry", errorClass });
    expect(result.retried).toBe(1);
  });

  it("computes the deferral from the DATABASE clock", async () => {
    const h = harness({
      send: async () => {
        throw Object.assign(new Error("x"), { statusCode: 500 });
      },
    });

    await run(h);

    // The fake now() is 2026-08-21T00:00:00Z; anything derived from the
    // process clock would land years away.
    expect(h.settled[0].nextAttemptAt!.getUTCFullYear()).toBe(2026);
    expect(h.settled[0].nextAttemptAt!.getTime()).toBeGreaterThan(
      new Date("2026-08-21T00:00:00.000Z").getTime()
    );
  });

  it("dead-letters instead of retrying once the budget is spent", async () => {
    const h = harness({
      rows: [claimedRow({ attempts: MAX_ATTEMPTS })],
      send: async () => {
        throw Object.assign(new Error("x"), { statusCode: 503 });
      },
    });

    const result = await run(h);

    // Keeps the class that actually caused it rather than overwriting
    // it with ATTEMPTS_EXHAUSTED.
    expect(h.settled[0]).toMatchObject({ kind: "failed", errorClass: "PROVIDER_5XX" });
    expect(result.retried).toBe(0);
    expect(result.failed).toBe(1);
  });

  it("still retries on the attempt just below the budget", async () => {
    const h = harness({
      rows: [claimedRow({ attempts: MAX_ATTEMPTS - 1 })],
      send: async () => {
        throw Object.assign(new Error("x"), { statusCode: 503 });
      },
    });

    await run(h);

    expect(h.settled[0].kind).toBe("retry");
  });
});

describe("the provider timeout aborts for real", () => {
  it("classifies a hanging provider as PROVIDER_TIMEOUT and retries", async () => {
    let aborted = false;
    const h = harness({
      send: (command) =>
        new Promise((_resolve, reject) => {
          command.signal!.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    });

    const result = await run(h, { providerTimeoutMs: 20 });

    expect(aborted).toBe(true);
    expect(h.settled[0]).toMatchObject({ kind: "retry", errorClass: "PROVIDER_TIMEOUT" });
    expect(result.retried).toBe(1);
  });

  it("settles well before a full lease would elapse", async () => {
    const h = harness({
      send: (command) =>
        new Promise((_resolve, reject) => {
          command.signal!.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          );
        }),
    });

    const started = Date.now();
    await run(h, { providerTimeoutMs: 30 });

    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("aborts in-flight sends when an external signal fires", async () => {
    const controller = new AbortController();
    const h = harness({
      send: (command) =>
        new Promise((_resolve, reject) => {
          command.signal!.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          );
          setTimeout(() => controller.abort(), 5);
        }),
    });

    const result = await run(h, { providerTimeoutMs: 60_000, signal: controller.signal });

    expect(result.retried).toBe(1);
  });
});

describe("a superseded settlement changes nothing", () => {
  it("counts zero-row settlements separately from success", async () => {
    const h = harness({ affectedRows: 0 });

    const result = await run(h);

    expect(result.superseded).toBe(1);
    expect(result.published).toBe(0);
  });

  it("does not retry or re-settle a superseded row", async () => {
    const h = harness({ affectedRows: 0 });

    await run(h);

    expect(h.settled).toHaveLength(1);
  });

  it("logs it with safe keys only", async () => {
    const h = harness({ affectedRows: 0 });

    await run(h);
    const entry = h.logs.find((l) => l.event === "outbox_relay_settlement_superseded")!;

    expect(Object.keys(entry).sort()).toEqual(["attempt", "event", "outboxEventId"].sort());
  });
});

describe("one row failing does not abandon the batch", () => {
  it("processes every claimed row", async () => {
    const rows = [
      claimedRow({ id: "aaaaaaaa-0000-0000-0000-000000000001" }),
      claimedRow({ id: "aaaaaaaa-0000-0000-0000-000000000002", payload: { broken: true } }),
      claimedRow({ id: "aaaaaaaa-0000-0000-0000-000000000003" }),
    ];
    const h = harness({ rows });

    const result = await run(h);

    expect(h.settled).toHaveLength(3);
    expect(result.published).toBe(2);
    expect(result.failed).toBe(1);
  });

  it("survives a provider that throws a non-Error", async () => {
    const h = harness({
      send: async () => {
        throw "a string";
      },
    });

    const result = await run(h);

    expect(h.settled[0]).toMatchObject({ kind: "retry", errorClass: "UNKNOWN" });
    expect(result.superseded).toBe(0);
  });
});

describe("logging carries no content", () => {
  const FORBIDDEN = ["buyer@example.com", "subject", "htmlBody", "textBody", "params", "payload", "stack"];

  it("emits only allowlisted keys on a settled row", async () => {
    const h = harness();

    await run(h);
    const entry = h.logs.find((l) => l.event === "outbox_relay_settled")!;

    expect(Object.keys(entry).sort()).toEqual(
      [
        "attempt",
        "durationMs",
        "errorClass",
        "event",
        "eventType",
        "outboxEventId",
        "outcome",
        "providerMode",
        "workerId",
      ].sort()
    );
  });

  it.each(FORBIDDEN)("never logs %s anywhere in a pass", async (fragment) => {
    const h = harness({
      send: async () => {
        throw Object.assign(new Error("SMTP 550 buyer@example.com subject=Order"), {
          statusCode: 500,
        });
      },
    });

    await run(h);

    expect(JSON.stringify(h.logs)).not.toContain(fragment);
  });

  it("carries providerMode on the pass summary", async () => {
    const h = harness();

    await run(h);
    const summary = h.logs.find((l) => l.event === "outbox_relay_pass")!;

    expect(summary.providerMode).toBe("mock");
  });

  it("describes success as provider_accepted, never delivered", async () => {
    const h = harness();

    await run(h);

    const serialised = JSON.stringify(h.logs);
    expect(serialised).toContain("provider_accepted");
    expect(serialised).not.toContain("delivered");
    expect(serialised).not.toContain("sent successfully");
  });

  it("reports terminalised rows without naming them individually", async () => {
    const h = harness({ terminalised: [{ id: "x" }, { id: "y" }] });

    await run(h);
    const entry = h.logs.find((l) => l.event === "outbox_relay_terminalised")!;

    expect(entry.count).toBe(2);
    expect(Object.keys(entry)).not.toContain("ids");
  });
});

describe("structural contract of the processor", () => {
  const SOURCE = readFileSync(join(__dirname, "outbox-relay-processor.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each(["notification", "auditLog", "audit_logs", "AuditService"])(
    "never references %s",
    (name) => {
      expect(SOURCE).not.toContain(name);
    }
  );

  it("reads users only through a narrow select", () => {
    expect(SOURCE).toContain("select: { email: true, status: true }");
    expect(SOURCE.match(/prisma\.user\./g)).toHaveLength(1);
  });

  it("never reads an exception message or stack", () => {
    expect(SOURCE).not.toMatch(/\.message\b/);
    expect(SOURCE).not.toMatch(/\.stack\b/);
  });

  it("clears the timeout in a finally block", () => {
    expect(SOURCE).toMatch(/finally\s*\{[\s\S]*?clearTimeout/);
  });

  it("dispatches through the bounded pool, never Promise.all over the batch", () => {
    expect(SOURCE).toContain("runBounded(");
    expect(SOURCE).not.toMatch(/Promise\.all\(\s*claimed/);
  });
});

describe("an empty claim does no work", () => {
  it("skips dispatch entirely", async () => {
    const h = harness({ rows: [] });

    const result = await run(h);

    expect(result.claimed).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(h.settled).toHaveLength(0);
  });

  it("still reports terminalised rows", async () => {
    const h = harness({ rows: [], terminalised: [{ id: "x" }] });

    const result = await run(h);

    expect(result.terminalised).toBe(1);
  });
});
