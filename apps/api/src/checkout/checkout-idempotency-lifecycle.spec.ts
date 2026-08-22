/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CheckoutSessionService } from "./checkout-session.service";
import { BusinessException } from "../common/errors/business-exception";

/**
 * The FIRST of the two idempotency keys in the purchase flow:
 * `POST /trader/checkout-sessions`.
 *
 * The lifecycle it has to keep:
 *
 *   generated  by the CLIENT, one per logical operation, sent as the
 *              `Idempotency-Key` header. The server never invents one —
 *              a server-generated key cannot make a retry recognisable,
 *              because the retry would arrive with a different one.
 *   stored     in `idempotency_keys (scope, key)`, where scope is
 *              `TRADER_CHECKOUT_CREATE:<companyId>`. Scoping by company
 *              means one tenant's key cannot collide with another's.
 *   bound      to `request_hash = sha256(canonicalize(dto))` over
 *              `{opportunityId, quantity, allocations sorted by
 *              companyLocationId}` — the operation's whole meaning.
 *   replayed   a retry with the same key and the same inputs returns
 *              the STORED response, and creates nothing further.
 *   rejected   the same key with DIFFERENT inputs is a conflict, never
 *              a silent replay of the wrong response.
 *
 * These tests emulate the `idempotency_keys` table in memory and drive
 * the real service against it. Checkout's own pricing and locking are
 * stubbed: they have their own tests, and what is under examination
 * here is the key lifecycle around them.
 */

const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "99999999-9999-9999-9999-999999999999";
const CTX = { userId: "u", companyId: COMPANY, requestId: "req-1" };

const DTO = {
  opportunityId: "55555555-5555-5555-5555-555555555555",
  quantity: 8,
  allocations: [
    { companyLocationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", quantity: 4 },
    { companyLocationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantity: 4 },
  ],
};

interface KeyRow {
  scope: string;
  key: string;
  request_hash: string;
  status: string;
  response_snapshot: unknown;
}

/**
 * A prisma double backed by an in-memory `idempotency_keys` table.
 *
 * The service talks to that table through raw SQL, so the fake
 * dispatches on the statement shape rather than on a method name.
 */
function buildHarness() {
  const table = new Map<string, KeyRow>();
  const created: string[] = [];

  const id = (scope: string, key: string) => `${scope}::${key}`;

  const client: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");

      if (sql.includes("INSERT INTO idempotency_keys")) {
        const [scope, key, requestHash] = values as string[];
        if (table.has(id(scope, key))) return []; // ON CONFLICT DO NOTHING
        table.set(id(scope, key), {
          scope,
          key,
          request_hash: requestHash,
          status: "IN_PROGRESS",
          response_snapshot: null,
        });
        return [{ id: "claim" }];
      }

      if (sql.includes("SELECT status, request_hash, response_snapshot")) {
        const [scope, key] = values as string[];
        const row = table.get(id(scope, key));
        return row ? [row] : [];
      }

      return [];
    },

    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("UPDATE idempotency_keys")) {
        const [snapshot, scope, key] = values as [string, string, string];
        const row = table.get(id(scope, key));
        if (row) {
          row.status = "COMPLETED";
          row.response_snapshot = JSON.parse(snapshot);
        }
      }
      return 1;
    },

    $transaction: async (fn: any) => fn(client),
  };

  const service = new CheckoutSessionService(client, {} as any, {} as any);

  // Pricing and the lock have their own tests; what is under
  // examination here is the key lifecycle around them.
  (service as any).priceCheckout = async () => ({ priced: [], tariff: { id: "t" } });
  (service as any).performCheckoutTx = async () => {
    const sessionId = `session-${created.length + 1}`;
    created.push(sessionId);
    return { id: sessionId, status: "LOCKED", grandTotalAmount: "995.50", masterOrderId: null };
  };

  return { service, table, created };
}

describe("POST /trader/checkout-sessions — the idempotency key lifecycle", () => {
  it("stores the key under a scope that carries the company", () => {
    // Two tenants can pick the same key; without the company in the
    // scope, one would replay the other's checkout session.
    const { service, table } = buildHarness();

    return service
      .create(DTO as any, "key-1", CTX)
      .then(() => {
        const [row] = [...table.values()];
        expect(row.scope).toBe(`TRADER_CHECKOUT_CREATE:${COMPANY}`);
        expect(row.key).toBe("key-1");
        expect(row.status).toBe("COMPLETED");
      });
  });

  it("binds the key to a fingerprint of opportunity, quantity and allocations", async () => {
    const { service, table } = buildHarness();

    await service.create(DTO as any, "key-1", CTX);
    const hash = [...table.values()][0].request_hash;

    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Same meaning, different order: allocations are sorted before
    // hashing, so a client that lists branches differently on a retry
    // still gets its own response rather than a conflict.
    const reordered = { ...DTO, allocations: [...DTO.allocations].reverse() };
    const second = buildHarness();
    await second.service.create(reordered as any, "key-1", CTX);

    expect([...second.table.values()][0].request_hash).toBe(hash);
  });

  it("changes the fingerprint when any part of the request changes", async () => {
    const hashes = new Set<string>();

    for (const dto of [
      DTO,
      { ...DTO, quantity: 12 },
      { ...DTO, opportunityId: "66666666-6666-6666-6666-666666666666" },
      {
        ...DTO,
        allocations: [
          { companyLocationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantity: 8 },
        ],
      },
    ]) {
      const { service, table } = buildHarness();
      await service.create(dto as any, "key-1", CTX);
      hashes.add([...table.values()][0].request_hash);
    }

    expect(hashes.size).toBe(4);
  });

  it("replays the stored response for a retry with the same key — the network-unknown case", async () => {
    // The client did not learn the outcome. It retries with the SAME
    // key, and gets its original answer rather than a second session.
    const { service, created } = buildHarness();

    const first = await service.create(DTO as any, "key-1", CTX);
    const retry = await service.create(DTO as any, "key-1", CTX);

    expect(retry).toEqual(first);
    expect(created).toEqual(["session-1"]);
  });

  it("blocks a double submit rather than creating two sessions", async () => {
    // Two clicks, one key, concurrently. The second loses the INSERT
    // race and reads the winner's row.
    const { service, created } = buildHarness();

    const [a, b] = await Promise.all([
      service.create(DTO as any, "key-1", CTX),
      service.create(DTO as any, "key-1", CTX),
    ]);

    expect(created).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it("refuses the same key with DIFFERENT inputs", async () => {
    // Never a silent replay: the caller would receive a response about
    // a purchase they did not just ask for.
    const { service, created } = buildHarness();

    await service.create(DTO as any, "key-1", CTX);

    await expect(
      service.create({ ...DTO, quantity: 99 } as any, "key-1", CTX)
    ).rejects.toBeInstanceOf(BusinessException);

    expect(created).toEqual(["session-1"]);
  });

  it("treats a NEW key as a new operation", async () => {
    // Which is why a changed request must carry a new key: the client
    // owns that decision, and the fingerprint check is what tells it
    // when it got the decision wrong.
    const { service, created } = buildHarness();

    await service.create(DTO as any, "key-1", CTX);
    await service.create({ ...DTO, quantity: 12 } as any, "key-2", CTX);

    expect(created).toEqual(["session-1", "session-2"]);
  });

  it("keeps one company's key from replaying another's session", async () => {
    const { service, created } = buildHarness();

    await service.create(DTO as any, "key-1", CTX);
    await service.create(DTO as any, "key-1", { ...CTX, companyId: OTHER_COMPANY });

    expect(created).toEqual(["session-1", "session-2"]);
  });
});

describe("the create path's key handling, read from its source", () => {
  const SOURCE = readFileSync(join(__dirname, "checkout-session.service.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("takes the key from the caller and never invents one", () => {
    // A server-generated key cannot make a retry recognisable: the
    // retry would arrive with a different one.
    expect(SOURCE).toMatch(/create\([\s\S]*?idempotencyKey: string/);
    expect(SOURCE).not.toContain("randomUUID");
  });

  it("claims the key with ON CONFLICT DO NOTHING, not a read-then-write", () => {
    // A SELECT followed by an INSERT has a window between them in which
    // two concurrent requests both see nothing and both proceed.
    expect(SOURCE).toMatch(/INSERT INTO idempotency_keys[\s\S]*?ON CONFLICT \(scope, key\) DO NOTHING/);
  });

  it("waits on the row lock rather than polling for the winner", () => {
    expect(SOURCE).toContain("FOR UPDATE");
  });

  it("gives the key a bounded lifetime", () => {
    // A key kept forever would eventually replay a response about a
    // checkout session long since expired.
    expect(SOURCE).toMatch(/IDEMPOTENCY_TTL_HOURS/);
    expect(SOURCE).toMatch(/expires_at/);
  });

  it("hashes a canonical form, so ordering is not part of the identity", () => {
    expect(SOURCE).toMatch(/createHash\("sha256"\)[\s\S]*?canonicalize\(dto\)/);
    expect(SOURCE).toMatch(/function canonicalize[\s\S]*?\.sort\(/);
  });
});
