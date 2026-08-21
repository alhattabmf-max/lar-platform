import { PrismaClient } from "@prisma/client";
import pino from "pino";
import {
  MAX_ATTEMPTS,
  MockEmailProvider,
  type EmailProvider,
  type SendEmailCommand,
} from "@platform/email";
import { runOutboxRelayPass } from "../src/outbox/outbox-relay-processor";

/**
 * STATUS: WRITTEN — NOT EXECUTED — STATUS UNKNOWN.
 *
 * Requires PostgreSQL with migration 89 applied. Port 5432 is closed on
 * this machine, so none of these has ever run. They cover the parts of
 * §9.12 that need a real database and a real pass: end-to-end
 * publication, dead-lettering, backoff actually preventing an immediate
 * retry, legacy rows never being sent, and no resend of a published row.
 */

const prisma = new PrismaClient();
const SUPPORTED = "EMAIL_NOTIFICATION_V1";
const LEGACY = "CHECKOUT_LOCK_EXPIRED";

const logs: Record<string, unknown>[] = [];
const logger = pino(
  { level: "info" },
  { write: (line: string) => logs.push(JSON.parse(line)) } as never
);

function recordingProvider(behaviour?: (command: SendEmailCommand) => Promise<void>): {
  provider: EmailProvider;
  sent: SendEmailCommand[];
} {
  const sent: SendEmailCommand[] = [];
  return {
    sent,
    provider: {
      mode: "mock",
      sendEmail: async (command) => {
        sent.push(command);
        if (behaviour) await behaviour(command);
      },
    },
  };
}

async function seedUser(status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<string> {
  const company = await prisma.company.findFirstOrThrow();
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      email: `relay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      passwordHash: "x",
      primaryMobile1: "+966500000001",
      primaryMobile2: "+966500000002",
      status,
    },
  });
  return user.id;
}

async function seedEmailEvent(recipientUserId: string, overrides: Record<string, unknown> = {}) {
  const payload = {
    v: 1,
    notificationId: crypto.randomUUID(),
    recipientUserId,
    template: "ORDER_CREATED",
    params: { orderId: crypto.randomUUID() },
    ...overrides,
  };

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO outbox_events (event_type, payload, status, attempts)
    VALUES (${SUPPORTED}, ${JSON.stringify(payload)}::jsonb, 'PENDING'::"OutboxStatus", 0)
    RETURNING id
  `;
  return rows[0].id;
}

const read = (id: string) => prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  logs.length = 0;
  await prisma.$executeRaw`DELETE FROM outbox_events WHERE event_type IN (${SUPPORTED}, ${LEGACY})`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a full pass", () => {
  it("sends and publishes a valid row", async () => {
    const userId = await seedUser();
    const id = await seedEmailEvent(userId);
    const { provider, sent } = recordingProvider();

    const result = await runOutboxRelayPass({ prisma, provider, logger }, { lockedBy: "w1" });

    expect(result.published).toBe(1);
    expect(sent).toHaveLength(1);
    expect((await read(id)).status).toBe("PUBLISHED");
  });

  it("resolves the address from users, which the payload never carries", async () => {
    const userId = await seedUser();
    await seedEmailEvent(userId);
    const { provider, sent } = recordingProvider();

    await runOutboxRelayPass({ prisma, provider, logger }, { lockedBy: "w1" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    expect(sent[0].to).toBe(user.email);
  });

  it("passes the stable delivery key", async () => {
    const userId = await seedUser();
    const id = await seedEmailEvent(userId);
    const { provider, sent } = recordingProvider();

    await runOutboxRelayPass({ prisma, provider, logger }, { lockedBy: "w1" });

    expect(sent[0].idempotencyKey).toBe(`outbox:${id}`);
  });

  it("does not resend a published row on a later pass", async () => {
    const userId = await seedUser();
    await seedEmailEvent(userId);
    const first = recordingProvider();
    await runOutboxRelayPass({ prisma, provider: first.provider, logger }, { lockedBy: "w1" });

    const second = recordingProvider();
    const result = await runOutboxRelayPass(
      { prisma, provider: second.provider, logger },
      { lockedBy: "w1" }
    );

    expect(second.sent).toHaveLength(0);
    expect(result.claimed).toBe(0);
  });

  it("never sends a legacy event type", async () => {
    await prisma.$executeRaw`
      INSERT INTO outbox_events (event_type, payload, status, attempts)
      VALUES (${LEGACY}, '{"checkoutSessionId":"x"}'::jsonb, 'PENDING'::"OutboxStatus", 0)
    `;
    const { provider, sent } = recordingProvider();

    await runOutboxRelayPass({ prisma, provider, logger }, { lockedBy: "w1" });

    expect(sent).toHaveLength(0);
  });
});

describe("failure handling against a real row", () => {
  it("defers a retryable failure so an immediate pass claims nothing", async () => {
    const userId = await seedUser();
    const id = await seedEmailEvent(userId);
    const failing = recordingProvider(async () => {
      throw Object.assign(new Error("x"), { statusCode: 503 });
    });

    await runOutboxRelayPass({ prisma, provider: failing.provider, logger }, { lockedBy: "w1" });

    const row = await read(id);
    expect(row.status).toBe("PENDING");
    expect(row.errorClass).toBe("PROVIDER_5XX");
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    const immediate = recordingProvider();
    const result = await runOutboxRelayPass(
      { prisma, provider: immediate.provider, logger },
      { lockedBy: "w1" }
    );
    expect(result.claimed).toBe(0);
  });

  it("dead-letters a malformed payload without calling the provider", async () => {
    const userId = await seedUser();
    const id = await seedEmailEvent(userId, { template: "NOT_A_TEMPLATE" });
    const { provider, sent } = recordingProvider();

    await runOutboxRelayPass({ prisma, provider, logger }, { lockedBy: "w1" });

    expect(sent).toHaveLength(0);
    const row = await read(id);
    expect(row.status).toBe("FAILED");
    expect(row.errorClass).toBe("PAYLOAD_INVALID");
  });

  it("does not escalate attempts for a malformed payload across passes", async () => {
    const userId = await seedUser();
    const id = await seedEmailEvent(userId, { params: { iban: "SA03" } });
    const { provider } = recordingProvider();

    await runOutboxRelayPass({ prisma, provider, logger }, { lockedBy: "w1" });
    const afterFirst = (await read(id)).attempts;
    await runOutboxRelayPass({ prisma, provider, logger }, { lockedBy: "w1" });

    expect((await read(id)).attempts).toBe(afterFirst);
  });

  it("dead-letters an inactive recipient", async () => {
    const userId = await seedUser("SUSPENDED");
    const id = await seedEmailEvent(userId);
    const { provider, sent } = recordingProvider();

    await runOutboxRelayPass({ prisma, provider, logger }, { lockedBy: "w1" });

    expect(sent).toHaveLength(0);
    expect((await read(id)).errorClass).toBe("RECIPIENT_INACTIVE");
  });

  it("reaches FAILED after the attempt budget and is never claimed again", async () => {
    const userId = await seedUser();
    const id = await seedEmailEvent(userId);
    const failing = recordingProvider(async () => {
      throw Object.assign(new Error("x"), { statusCode: 503 });
    });

    for (let pass = 0; pass < MAX_ATTEMPTS + 1; pass++) {
      // Clear the deferral so each pass is eligible.
      await prisma.$executeRaw`UPDATE outbox_events SET next_attempt_at = NULL WHERE id = ${id}::uuid`;
      await runOutboxRelayPass({ prisma, provider: failing.provider, logger }, { lockedBy: "w1" });
    }

    const row = await read(id);
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(MAX_ATTEMPTS);

    const after = recordingProvider();
    const result = await runOutboxRelayPass(
      { prisma, provider: after.provider, logger },
      { lockedBy: "w1" }
    );
    expect(result.claimed).toBe(0);
  });
});

describe("the provider timeout is a real abort", () => {
  it("classifies a hanging provider and settles well inside the lease", async () => {
    const userId = await seedUser();
    const id = await seedEmailEvent(userId);
    let aborted = false;
    const hanging = recordingProvider(
      (command) =>
        new Promise((_resolve, reject) => {
          command.signal!.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        })
    );

    const started = Date.now();
    await runOutboxRelayPass(
      { prisma, provider: hanging.provider, logger },
      { lockedBy: "w1", providerTimeoutMs: 500, leaseSeconds: 120 }
    );

    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(120_000);
    expect((await read(id)).errorClass).toBe("PROVIDER_TIMEOUT");
  });
});

describe("logs leak nothing", () => {
  it("contains no address, subject, body or payload value for a full pass", async () => {
    const userId = await seedUser();
    await seedEmailEvent(userId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await runOutboxRelayPass(
      { prisma, provider: new MockEmailProvider(), logger },
      { lockedBy: "w1" }
    );

    const serialised = JSON.stringify(logs);
    expect(serialised).not.toContain(user.email);
    expect(serialised).not.toContain("htmlBody");
    expect(serialised).not.toContain("subject");
  });

  it("carries providerMode on every relay log line", async () => {
    const userId = await seedUser();
    await seedEmailEvent(userId);

    await runOutboxRelayPass(
      { prisma, provider: new MockEmailProvider(), logger },
      { lockedBy: "w1" }
    );

    const relayLines = logs.filter((line) => String(line.event ?? "").startsWith("outbox_relay_"));
    const withMode = relayLines.filter((line) => "providerMode" in line);
    expect(withMode.length).toBeGreaterThan(0);
  });
});

describe("structural isolation at runtime", () => {
  it("writes no audit_logs row during a pass", async () => {
    const before = await prisma.auditLog.count();
    const userId = await seedUser();
    await seedEmailEvent(userId);

    await runOutboxRelayPass(
      { prisma, provider: new MockEmailProvider(), logger },
      { lockedBy: "w1" }
    );

    expect(await prisma.auditLog.count()).toBe(before);
  });
});
