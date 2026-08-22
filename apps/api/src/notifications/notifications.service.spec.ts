/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { NotFoundException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_ITEM_KEYS,
  type NotificationItem,
} from "@platform/types";
import { NotificationsService } from "./notifications.service";

const USER = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const COMPANY = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NOTIFICATION = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const SCOPE = { userId: USER, companyId: COMPANY };

function row(overrides: Record<string, unknown> = {}) {
  return {
    readAt: null,
    notification: {
      id: NOTIFICATION,
      type: "ORDER_CREATED",
      entityType: "master_order",
      entityId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      params: { orderId: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
      createdAt: new Date("2026-08-21T00:00:00.000Z"),
    },
    ...overrides,
  };
}

function harness(options: { rows?: unknown[]; total?: number; found?: unknown; affected?: number } = {}) {
  // Typed with rest parameters so `mock.calls[0][0]` is a real element
  // rather than an index into an empty tuple.
  const findMany = jest.fn((..._args: any[]) => Promise.resolve(options.rows ?? [row()]));
  const count = jest.fn((..._args: any[]) => Promise.resolve(options.total ?? 1));
  const findFirst = jest.fn((..._args: any[]) =>
    Promise.resolve(options.found === undefined ? { readAt: null } : options.found)
  );
  const executeRaw = jest.fn((..._args: any[]) => Promise.resolve(options.affected ?? 1));

  const prisma = {
    notificationRecipient: { findMany, count, findFirst },
    $executeRaw: executeRaw,
  };

  return { prisma, findMany, count, findFirst, executeRaw, service: new NotificationsService(prisma as never) };
}

describe("isolation lives in the query", () => {
  it("scopes the list by BOTH user and company", async () => {
    const h = harness();

    await h.service.list(SCOPE, {});

    expect(h.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      notification: { companyId: COMPANY },
    });
  });

  it("scopes the unread count the same way", async () => {
    const h = harness();

    await h.service.unreadCount(SCOPE);

    expect(h.count.mock.calls[0][0].where).toEqual({
      userId: USER,
      notification: { companyId: COMPANY },
      readAt: null,
    });
  });

  it("counts against the SAME predicate the page was read with", async () => {
    const h = harness();

    await h.service.list(SCOPE, { page: 2 });

    expect(h.count.mock.calls[0][0].where).toEqual(h.findMany.mock.calls[0][0].where);
  });

  it("binds both ids into the mark-read statement", async () => {
    const h = harness();

    await h.service.markRead(SCOPE, NOTIFICATION);

    expect(h.executeRaw.mock.calls[0].slice(1)).toEqual(
      expect.arrayContaining([NOTIFICATION, USER, COMPANY])
    );
  });

  it("throws 404 — never 403 — for a notification that is not this user's", async () => {
    const h = harness({ affected: 0, found: null });

    // A 403 would confirm the id exists and turn this into an
    // enumeration oracle.
    await expect(h.service.markRead(SCOPE, NOTIFICATION)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("ordering and pagination", () => {
  it("orders newest first, terminating in a unique column", async () => {
    const h = harness();

    await h.service.list(SCOPE, {});

    expect(h.findMany.mock.calls[0][0].orderBy).toEqual([
      { notification: { createdAt: "desc" } },
      { notification: { id: "asc" } },
    ]);
  });

  it("defaults to page 1", async () => {
    const h = harness();

    const result = await h.service.list(SCOPE, {});

    expect(result.page).toBe(1);
    expect(h.findMany.mock.calls[0][0].skip).toBe(0);
  });

  it("advances skip by exactly one page", async () => {
    const h = harness();

    await h.service.list(SCOPE, { page: 3, pageSize: 10 });

    expect(h.findMany.mock.calls[0][0].skip).toBe(20);
    expect(h.findMany.mock.calls[0][0].take).toBe(10);
  });

  it("clamps a page size above the ceiling", async () => {
    const h = harness();

    const result = await h.service.list(SCOPE, { pageSize: 5_000 });

    expect(result.pageSize).toBe(MAX_NOTIFICATION_PAGE_SIZE);
    expect(h.findMany.mock.calls[0][0].take).toBe(MAX_NOTIFICATION_PAGE_SIZE);
  });

  it("treats a nonsense page as the first", async () => {
    const h = harness();

    expect((await h.service.list(SCOPE, { page: 0 })).page).toBe(1);
    expect((await h.service.list(SCOPE, { page: -4 })).page).toBe(1);
  });

  it("reports the total independently of the page", async () => {
    const h = harness({ total: 97 });

    expect((await h.service.list(SCOPE, { page: 2 })).total).toBe(97);
  });
});

describe("the item projection is closed", () => {
  it("returns exactly the contract keys", async () => {
    const h = harness();

    const item = (await h.service.list(SCOPE, {})).items[0];

    expect(Object.keys(item).sort()).toEqual([...NOTIFICATION_ITEM_KEYS].sort());
  });

  it("carries no rendered text of any kind", async () => {
    const h = harness();

    const item = (await h.service.list(SCOPE, {})).items[0];

    for (const field of ["title", "body", "message", "subject", "html", "text"]) {
      expect(item).not.toHaveProperty(field);
    }
  });

  it("exposes no email address, delivery status or outbox notion", async () => {
    const h = harness();

    const serialised = JSON.stringify(await h.service.list(SCOPE, {}));

    for (const field of ["email", "outbox", "delivered", "dedupeKey", "companyId", "userId"]) {
      expect(serialised).not.toContain(field);
    }
  });

  it("serialises timestamps as ISO strings", async () => {
    const h = harness({ rows: [row({ readAt: new Date("2026-08-22T10:00:00.000Z") })] });

    const item = (await h.service.list(SCOPE, {})).items[0];

    expect(item.createdAt).toBe("2026-08-21T00:00:00.000Z");
    expect(item.readAt).toBe("2026-08-22T10:00:00.000Z");
  });

  it("reports an unread item as readAt null", async () => {
    const h = harness();

    expect((await h.service.list(SCOPE, {})).items[0].readAt).toBeNull();
  });

  it("gives the UI identifiers to build a link, never a stored URL", async () => {
    const h = harness();

    const item: NotificationItem = (await h.service.list(SCOPE, {})).items[0];

    expect(item.entityType).toBe("master_order");
    expect(item.entityId).toBeTruthy();
    expect(JSON.stringify(item)).not.toContain("http");
  });

  it("defaults absent params to an empty object rather than null", async () => {
    const h = harness({ rows: [row({ notification: { ...row().notification, params: null } })] });

    expect((await h.service.list(SCOPE, {})).items[0].params).toEqual({});
  });
});

describe("read-state mutations are idempotent", () => {
  it("reports changed on the first mark", async () => {
    const h = harness({ affected: 1, found: { readAt: new Date("2026-08-22T10:00:00.000Z") } });

    const result = await h.service.markRead(SCOPE, NOTIFICATION);

    expect(result.changed).toBe(true);
    expect(result.readAt).toBe("2026-08-22T10:00:00.000Z");
  });

  it("reports unchanged on a repeat, preserving the ORIGINAL timestamp", async () => {
    const original = new Date("2026-08-22T10:00:00.000Z");
    const h = harness({ affected: 0, found: { readAt: original } });

    const result = await h.service.markRead(SCOPE, NOTIFICATION);

    // A double-click must not make a notification look newly read.
    expect(result.changed).toBe(false);
    expect(result.readAt).toBe(original.toISOString());
  });

  it("only moves rows that are still unread", async () => {
    const h = harness();

    await h.service.markRead(SCOPE, NOTIFICATION);

    expect(h.executeRaw.mock.calls[0][0].raw.join(" ")).toContain("read_at IS NULL");
  });

  it("reads the clock from the database, not the process", async () => {
    const h = harness();

    await h.service.markRead(SCOPE, NOTIFICATION);

    expect(h.executeRaw.mock.calls[0][0].raw.join(" ")).toContain("read_at = now()");
  });

  it("read-all returns how many rows it actually moved", async () => {
    const h = harness({ affected: 7 });

    expect(await h.service.markAllRead(SCOPE)).toEqual({ changed: 7 });
  });

  it("read-all on an already-clear inbox reports zero, not an error", async () => {
    const h = harness({ affected: 0 });

    await expect(h.service.markAllRead(SCOPE)).resolves.toEqual({ changed: 0 });
  });

  it("read-all is scoped to this user alone", async () => {
    const h = harness();

    await h.service.markAllRead(SCOPE);
    const sql = h.executeRaw.mock.calls[0][0].raw.join(" ");

    expect(sql).toContain("nr.user_id =");
    expect(sql).toContain("n.company_id =");
  });
});

describe("the read service is role-neutral and reusable", () => {
  const SERVICE = readFileSync(join(__dirname, "notifications.service.ts"), "utf8");
  const CONTROLLER = readFileSync(join(__dirname, "trader-notifications.controller.ts"), "utf8");

  it("mentions no role anywhere — isolation is by user and company only", () => {
    // A supplier controller in 8E can reuse this service unchanged; the
    // isolation logic must not be duplicated or re-derived per role.
    for (const role of ["TRADER", "SUPPLIER", "RequireTrader", "RequireSupplier", "accountType"]) {
      expect(SERVICE).not.toContain(role);
    }
  });

  it("takes its scope as a parameter rather than reading a session", () => {
    expect(SERVICE).toContain("NotificationScope");
    expect(SERVICE).not.toContain("SessionData");
    expect(SERVICE).not.toContain("CurrentSession");
  });

  it("puts the role guard on the CONTROLLER, where it belongs", () => {
    expect(CONTROLLER).toContain("RequireTraderGuard");
    expect(CONTROLLER).toContain("SessionAuthGuard");
  });

  it("keeps a supplier out of the trader routes today", () => {
    // A supplier recipient genuinely has notifications — ORDER_CREATED,
    // DISPUTE_OPENED, REPLACEMENT_REQUIRED, SETTLEMENT_EXECUTED — but
    // no route to read them until 8E adds a supplier controller.
    expect(CONTROLLER).toMatch(
      /@UseGuards\(SessionAuthGuard, RequireTraderGuard, CsrfGuard\)/
    );
  });

  it("exposes exactly the four agreed routes", () => {
    const routes = CONTROLLER.match(/@(Get|Post)\(/g) ?? [];

    expect(routes).toHaveLength(4);
    expect(CONTROLLER).toContain('@Controller("trader/notifications")');
  });
});

describe("structural contract of the read service", () => {
  const SOURCE = readFileSync(join(__dirname, "notifications.service.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never spreads a database row into the response", () => {
    // A spread forwards whatever a future column adds.
    expect(SOURCE).not.toMatch(/\.\.\.row\b/);
    expect(SOURCE).not.toMatch(/\.\.\.notification\b/);
  });

  it("never throws Forbidden — the answer is always 404", () => {
    expect(SOURCE).not.toContain("ForbiddenException");
  });

  it("selects a closed column set rather than the whole row", () => {
    expect(SOURCE).toContain("RECIPIENT_SELECT");
    expect(SOURCE).not.toMatch(/include:\s*\{\s*notification:\s*true/);
  });
});
