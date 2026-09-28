import { NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { BannerService } from "./banner.service";
import type { BannerImageService } from "./banner-image.service";
import { LIVE_BANNER_CONDITION_B } from "./banner-visibility.sql";
import { BusinessException } from "../common/errors/business-exception";
import type { PrismaService } from "../database/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { BannerPolicyService } from "../settings/banner-policy.service";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const at = (m: number) => new Date(NOW.getTime() + m * 60_000);

const CTX = { actorId: "admin-1", requestId: "req-1" };

interface Row {
  id: string;
  placement: "PUBLIC_HOME" | "PUBLIC_OPPORTUNITIES";
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  // Deleting reads these; every other path ignores them.
  sortOrder?: number;
  imageObjectKey?: string | null;
  imageThumbnailKey?: string | null;
}

/**
 * Models the transaction boundary faithfully enough to assert ORDER:
 * every raw call and every write is recorded on one trace, so the tests
 * can prove the advisory lock precedes the clock read and the window
 * read, and that the audit write lands on the transaction client.
 */
/**
 * Artwork the mocked banners have.
 *
 * BOTH LANGUAGES BY DEFAULT, because these tests are about the lock,
 * the clock and the concurrent limit — not about the artwork rule. A
 * fixture missing an image would make every activation test fail for a
 * reason none of them is asking about. The tests that DO cover the rule
 * pass their own value.
 */
const BOTH_LOCALES = [
  { locale: "AR_SA" as const },
  { locale: "EN_SA" as const },
];

function makeService(
  rows: Row[] = [],
  maxConcurrent = 2,
  images: Array<{ locale: "AR_SA" | "EN_SA" }> = BOTH_LOCALES,
) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  const trace: string[] = [];
  let created: Row | null = null;

  /**
   * `$queryRaw` — and it refuses the advisory lock, exactly as the real
   * driver does.
   *
   * This mock used to answer the lock with `[{ pg_advisory_xact_lock:
   * null }]`, a row PostgreSQL never sends. That fiction is why every
   * banner create, activate and schedule shipped returning 500:
   * `pg_advisory_xact_lock()` returns SQL `void`, Prisma cannot
   * deserialize `void`, and `$queryRaw` therefore throws
   * "Failed to deserialize column of type 'void'" against a real
   * database while this suite stayed green.
   *
   * Reproducing the refusal here means the unit suite now fails the same
   * way production did, instead of certifying a call that cannot work.
   */
  const queryRaw = jest.fn(async (sql: unknown) => {
    const text = JSON.stringify(sql);
    if (text.includes("pg_advisory_xact_lock")) {
      throw new Error(
        "Failed to deserialize column of type 'void'. " +
          "pg_advisory_xact_lock() returns void — take the lock with $executeRaw, not $queryRaw."
      );
    }
    if (text.includes("now")) {
      trace.push("NOW");
      return [{ now: NOW }];
    }
    trace.push("RAW");
    return [];
  });

  /** `$executeRaw` returns an affected-row count and reads no columns. */
  const executeRaw = jest.fn(async (sql: unknown) => {
    const text = JSON.stringify(sql);
    if (text.includes("pg_advisory_xact_lock")) {
      trace.push("LOCK");
      return 1;
    }
    trace.push("EXEC");
    return 0;
  });

  const findMany = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    // The overlap read filters on isActive; reorder does not. Honour
    // whatever `where` actually asks for rather than assuming one shape.
    const wantsActive = Object.prototype.hasOwnProperty.call(where, "isActive");
    if (wantsActive) trace.push("READ_WINDOWS");
    else trace.push("READ_ALL");

    const exclude = (where.id as { not?: string } | undefined)?.not;
    return [...store.values()].filter(
      (r) =>
        r.placement === where.placement &&
        (!wantsActive || r.isActive === where.isActive) &&
        r.id !== exclude
    );
  });

  const findUnique = jest.fn(async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null);

  const update = jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
    trace.push("WRITE");
    const next = { ...store.get(where.id)!, ...data };
    store.set(where.id, next);
    return next;
  });

  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    trace.push("WRITE");
    created = { id: "created-1", ...(data as unknown as Omit<Row, "id">) };
    store.set("created-1", created);
    return created;
  });

  const remove = jest.fn(async ({ where }: { where: { id: string } }) => {
    trace.push("WRITE");
    const row = store.get(where.id)!;
    store.delete(where.id);
    return row;
  });

  // Which languages a banner has artwork for, read inside the lock when
  // something is being activated.
  const findImages = jest.fn(async () => images);

  const txClient = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    promotionalBanner: { findMany, findUnique, update, create, delete: remove },
    bannerImage: { findMany: findImages },
  };

  const prisma = {
    promotionalBanner: { findUnique },
    // The public reads are single statements outside any transaction —
    // they call $queryRaw on the client directly.
    $queryRaw: queryRaw,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      trace.push("TX_BEGIN");
      const result = await fn(txClient);
      trace.push("TX_COMMIT");
      return result;
    }),
  } as unknown as PrismaService;

  // Parameters are declared so the mock's call tuple is typed: the tests
  // assert on the SECOND argument (the transaction client), which is the
  // whole point of the atomic-audit change.
  const auditLog = jest.fn(
    async (_input: { action: string }, _tx?: unknown): Promise<void> => undefined
  );
  const audit = { log: auditLog } as unknown as AuditService;

  const policy = {
    getPolicy: jest.fn().mockResolvedValue({
      maxSizeBytes: 1,
      maxPixels: 1,
      allowedTypes: [],
      maxConcurrentLiveBannersPerPlacement: maxConcurrent,
    }),
  } as unknown as BannerPolicyService;

  /**
   * The placement each advisory lock was taken on, read from the bound
   * PARAMETERS rather than the SQL text — the key is a bound value, so
   * this is the only place it actually appears.
   */
  const lockKeys = (): string[] =>
    // Read from $executeRaw: the lock is a side-effect statement whose
    // void result must never be deserialized.
    executeRaw.mock.calls
      .map((c) => c[0] as Prisma.Sql)
      .filter((sql) => sql.sql.includes("pg_advisory_xact_lock"))
      .map((sql) => String(sql.values[sql.values.length - 1]));

  // Only `discardStoredImages` is ever reached from the service, and only
  // after a delete commits. A recording stub lets a test assert WHICH
  // keys were handed over, with no storage layer in the way.
  const discarded: Array<{ bannerId: string; keys: readonly string[] }> = [];
  const imageService = {
    discardStoredImages: async (bannerId: string, keys: readonly string[]) => {
      discarded.push({ bannerId, keys });
    },
  } as unknown as BannerImageService;

  return {
    service: new BannerService(prisma, audit, policy, imageService),
    trace,
    auditLog,
    store,
    queryRaw,
    lockKeys,
    discarded,
    getCreated: () => created,
  };
}

describe("ordering inside the transaction", () => {
  it("takes the placement lock BEFORE reading the clock or any window", async () => {
    const { service, trace } = makeService([
      { id: "b1", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
    ]);

    await service.setActive("b1", true, CTX);

    const lock = trace.indexOf("LOCK");
    const now = trace.indexOf("NOW");
    const read = trace.indexOf("READ_WINDOWS");

    expect(lock).toBeGreaterThan(trace.indexOf("TX_BEGIN"));
    expect(lock).toBeLessThan(now);
    expect(now).toBeLessThan(read);
  });

  it("performs the write and the audit inside the same transaction", async () => {
    const { service, trace, auditLog } = makeService([
      { id: "b1", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
    ]);

    await service.setActive("b1", true, CTX);

    expect(trace.indexOf("WRITE")).toBeLessThan(trace.indexOf("TX_COMMIT"));
    // The audit call receives the transaction client as its second
    // argument — that is what makes it atomic with the mutation.
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][1]).toBeDefined();
  });

  it("reads the clock exactly once per operation", async () => {
    const { service, trace } = makeService([
      { id: "b1", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
    ]);

    await service.setActive("b1", true, CTX);

    expect(trace.filter((t) => t === "NOW")).toHaveLength(1);
  });
});

describe("activation and the concurrent limit", () => {
  it("allows activation up to the limit", async () => {
    const { service, store } = makeService(
      [
        { id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null },
        { id: "b", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
      ],
      2
    );

    await service.setActive("b", true, CTX);

    expect(store.get("b")!.isActive).toBe(true);
  });

  it("refuses the activation that would exceed the limit", async () => {
    const { service, store, auditLog } = makeService(
      [
        { id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null },
        { id: "b", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null },
        { id: "c", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
      ],
      2
    );

    await expect(service.setActive("c", true, CTX)).rejects.toBeInstanceOf(BusinessException);
    expect(store.get("c")!.isActive).toBe(false);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("EXPIRED banners do not consume a slot", async () => {
    const { service, store } = makeService(
      [
        { id: "old1", placement: "PUBLIC_HOME", isActive: true, startsAt: at(-200), endsAt: at(-100) },
        { id: "old2", placement: "PUBLIC_HOME", isActive: true, startsAt: at(-200), endsAt: at(-100) },
        { id: "old3", placement: "PUBLIC_HOME", isActive: true, startsAt: at(-200), endsAt: at(-100) },
        { id: "new", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
      ],
      1
    );

    await service.setActive("new", true, CTX);

    expect(store.get("new")!.isActive).toBe(true);
  });

  it("deactivation skips the overlap READ but still takes the lock", async () => {
    const { service, trace } = makeService(
      [{ id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null }],
      1
    );

    await service.setActive("a", false, CTX);

    // Deactivating can only ever reduce overlap, so no read is needed.
    expect(trace).not.toContain("READ_WINDOWS");
    // The lock is still taken, so that EVERY mutation affecting display
    // state is serialised on one placement — a deactivation racing a
    // concurrent activation must not interleave.
    expect(trace).toContain("LOCK");
    expect(trace.indexOf("LOCK")).toBeLessThan(trace.indexOf("WRITE"));
  });

  it("banners in a DIFFERENT placement do not contend", async () => {
    const { service, store } = makeService(
      [
        { id: "other", placement: "PUBLIC_OPPORTUNITIES", isActive: true, startsAt: null, endsAt: null },
        { id: "mine", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
      ],
      1
    );

    await service.setActive("mine", true, CTX);

    expect(store.get("mine")!.isActive).toBe(true);
  });

  it("derives the lock key from the banner's own placement", async () => {
    const { service, lockKeys } = makeService([
      { id: "x", placement: "PUBLIC_OPPORTUNITIES", isActive: false, startsAt: null, endsAt: null },
    ]);

    await service.setActive("x", true, CTX);

    // NOTE: this asserts the lock KEY only. That two placements do not
    // block each other in practice is a PostgreSQL property this unit
    // test cannot observe — it is verified in CI, not here.
    expect(lockKeys()).toEqual(["PUBLIC_OPPORTUNITIES"]);
  });

  it("404s for an unknown banner", async () => {
    const { service } = makeService();
    await expect(service.setActive("missing", true, CTX)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("schedule changes on an active banner", () => {
  it("re-checks the limit when moving an active window into a conflict", async () => {
    const { service, store, auditLog } = makeService(
      [
        { id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: at(0), endsAt: at(60) },
        { id: "b", placement: "PUBLIC_HOME", isActive: true, startsAt: at(60), endsAt: at(120) },
      ],
      1
    );

    await expect(
      service.setSchedule("b", { startsAt: at(30), endsAt: at(120) }, CTX)
    ).rejects.toBeInstanceOf(BusinessException);

    expect(store.get("b")!.startsAt).toEqual(at(60));
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("allows a move that keeps windows merely touching", async () => {
    const { service, store } = makeService(
      [
        { id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: at(0), endsAt: at(60) },
        { id: "b", placement: "PUBLIC_HOME", isActive: true, startsAt: at(90), endsAt: at(120) },
      ],
      1
    );

    await service.setSchedule("b", { startsAt: at(60), endsAt: at(120) }, CTX);

    expect(store.get("b")!.startsAt).toEqual(at(60));
  });

  it("skips the overlap READ for an inactive banner — but still takes the lock", async () => {
    const { service, trace } = makeService(
      [
        { id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null },
        { id: "draft", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
      ],
      1
    );

    await service.setSchedule("draft", { startsAt: null, endsAt: null }, CTX);

    // No overlap computation is needed: an inactive banner cannot be
    // live, so it cannot contend for a slot.
    expect(trace).not.toContain("READ_WINDOWS");
    // The lock is still mandatory. Without it, a concurrent activation
    // could read this banner's OLD window, validate against it, and
    // commit — while this edit writes a NEW window that was never
    // validated. The result would be an active banner whose schedule
    // never passed the overlap check.
    expect(trace).toContain("LOCK");
  });

  it("takes the placement lock BEFORE writing an inactive banner's window", async () => {
    const { service, trace } = makeService([
      { id: "draft", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
    ]);

    await service.setSchedule("draft", { startsAt: at(10), endsAt: at(20) }, CTX);

    const lock = trace.indexOf("LOCK");
    const write = trace.indexOf("WRITE");

    expect(lock).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(write);
    expect(lock).toBeGreaterThan(trace.indexOf("TX_BEGIN"));
    expect(write).toBeLessThan(trace.indexOf("TX_COMMIT"));
  });

  it("rejects an inverted window before taking any lock", async () => {
    const { service, trace } = makeService([
      { id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null },
    ]);

    await expect(
      service.setSchedule("a", { startsAt: at(60), endsAt: at(30) }, CTX)
    ).rejects.toBeInstanceOf(BusinessException);
    expect(trace).not.toContain("LOCK");
  });

  it("rejects a zero-length window (endsAt equal to startsAt)", async () => {
    const { service } = makeService([
      { id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null },
    ]);

    await expect(
      service.setSchedule("a", { startsAt: at(60), endsAt: at(60) }, CTX)
    ).rejects.toBeInstanceOf(BusinessException);
  });
});

describe("create", () => {
  it("creates inactive without contending for a slot", async () => {
    const { service, trace, getCreated } = makeService(
      [{ id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null }],
      1
    );

    await service.create(
      {
        placement: "PUBLIC_HOME",
        linkUrl: null,
        sortOrder: 0,
        isActive: false,
        startsAt: null,
        endsAt: null,
      },
      CTX
    );

    expect(getCreated()).not.toBeNull();
    expect(trace).not.toContain("READ_WINDOWS");
  });

  it("checks the limit when created already active", async () => {
    const { service } = makeService(
      [{ id: "a", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null }],
      1
    );

    await expect(
      service.create(
        {
          placement: "PUBLIC_HOME",
          linkUrl: null,
          sortOrder: 0,
          isActive: true,
          startsAt: null,
          endsAt: null,
        },
        CTX
      )
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("writes an audit entry on the transaction client", async () => {
    const { service, auditLog } = makeService();

    await service.create(
      {
        placement: "PUBLIC_HOME",
        linkUrl: null,
        sortOrder: 0,
        isActive: false,
        startsAt: null,
        endsAt: null,
      },
      CTX
    );

    expect(auditLog.mock.calls[0][0].action).toBe("BANNER_CREATED");
    expect(auditLog.mock.calls[0][1]).toBeDefined();
  });
});

describe("reorder", () => {
  const three: Row[] = [
    { id: "a", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
    { id: "b", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
    { id: "c", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
  ];

  it("rewrites every position inside ONE transaction", async () => {
    const { service, trace } = makeService(three);

    await service.reorder("PUBLIC_HOME", ["c", "a", "b"], CTX);

    const begins = trace.filter((t) => t === "TX_BEGIN");
    const writes = trace.filter((t) => t === "WRITE");
    expect(begins).toHaveLength(1);
    // Three position updates plus nothing else, all before the commit.
    expect(writes).toHaveLength(3);
    expect(trace.lastIndexOf("WRITE")).toBeLessThan(trace.indexOf("TX_COMMIT"));
  });

  it("assigns positions matching the requested order", async () => {
    const { service, store } = makeService(three);

    await service.reorder("PUBLIC_HOME", ["c", "a", "b"], CTX);

    expect((store.get("c") as unknown as { sortOrder: number }).sortOrder).toBe(0);
    expect((store.get("a") as unknown as { sortOrder: number }).sortOrder).toBe(1);
    expect((store.get("b") as unknown as { sortOrder: number }).sortOrder).toBe(2);
  });

  it("refuses duplicate ids", async () => {
    const { service } = makeService(three);

    await expect(
      service.reorder("PUBLIC_HOME", ["a", "a", "b"], CTX)
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("refuses a partial list — reordering a subset would collide positions", async () => {
    const { service, auditLog } = makeService(three);

    await expect(service.reorder("PUBLIC_HOME", ["a", "b"], CTX)).rejects.toBeInstanceOf(
      BusinessException
    );
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("refuses an id from another placement", async () => {
    const { service } = makeService([
      ...three,
      { id: "other", placement: "PUBLIC_OPPORTUNITIES", isActive: false, startsAt: null, endsAt: null },
    ]);

    await expect(
      service.reorder("PUBLIC_HOME", ["a", "b", "c", "other"], CTX)
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("refuses an unknown id", async () => {
    const { service } = makeService(three);

    await expect(
      service.reorder("PUBLIC_HOME", ["a", "b", "ghost"], CTX)
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("writes one audit entry on the transaction client", async () => {
    const { service, auditLog } = makeService(three);

    await service.reorder("PUBLIC_HOME", ["c", "b", "a"], CTX);

    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][0].action).toBe("BANNER_REORDERED");
    expect(auditLog.mock.calls[0][1]).toBeDefined();
  });
});

describe("every display-affecting mutation is serialised on one lock", () => {
  /**
   * The race this guards against: an activation reads the banner's OLD
   * window and validates overlap against it, while a concurrent edit
   * writes a NEW window. Both commit, and the banner ends up active
   * with a schedule that never passed validation.
   *
   * These tests assert that all four mutations request the SAME lock
   * key, which is what makes PostgreSQL serialise them. That they
   * actually block each other is a database property, verified in CI.
   */
  it("activation and an inactive-window edit of the same banner take the same lock key", async () => {
    const { service, lockKeys } = makeService([
      { id: "b", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null },
    ]);

    await service.setSchedule("b", { startsAt: at(10), endsAt: at(20) }, CTX);
    await service.setActive("b", true, CTX);

    const keys = lockKeys();
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("PUBLIC_HOME");
  });

  it("all four mutations on one placement request the identical key", async () => {
    const { service, lockKeys } = makeService(
      [{ id: "b", placement: "PUBLIC_HOME", isActive: false, startsAt: null, endsAt: null }],
      5
    );

    await service.create(
      {
        placement: "PUBLIC_HOME",
        linkUrl: null,
        sortOrder: 0,
        isActive: false,
        startsAt: null,
        endsAt: null,
      },
      CTX
    );
    await service.setSchedule("b", { startsAt: at(10), endsAt: at(20) }, CTX);
    await service.setActive("b", true, CTX);
    await service.setActive("b", false, CTX);

    const keys = lockKeys();
    expect(keys).toHaveLength(4);
    expect(new Set(keys)).toEqual(new Set(["PUBLIC_HOME"]));
  });

  it("every mutation takes its lock inside the transaction, before any write", async () => {
    for (const run of [
      async (s: BannerService) => s.setSchedule("b", { startsAt: at(1), endsAt: at(2) }, CTX),
      async (s: BannerService) => s.setActive("b", true, CTX),
      async (s: BannerService) => s.setActive("b", false, CTX),
    ]) {
      const { service, trace } = makeService([
        { id: "b", placement: "PUBLIC_HOME", isActive: true, startsAt: null, endsAt: null },
      ]);

      await run(service);

      expect(trace.indexOf("TX_BEGIN")).toBeLessThan(trace.indexOf("LOCK"));
      expect(trace.indexOf("LOCK")).toBeLessThan(trace.indexOf("WRITE"));
      expect(trace.indexOf("WRITE")).toBeLessThan(trace.indexOf("TX_COMMIT"));
    }
  });
});

describe("the LIVE predicate is shared, not restated", () => {
  /** Prisma inlines a nested fragment verbatim, so this is an exact test. */
  const sqlTextOf = (call: unknown) => (call as Prisma.Sql).sql;

  it("listLive and findLiveImage both embed the ONE shared fragment", async () => {
    const { service, queryRaw } = makeService();

    await service.listLive("PUBLIC_HOME", "ar-SA");
    await service.findLiveImage(
      "11111111-1111-1111-1111-111111111111",
      "ar-SA",
    );

    const withPredicate = queryRaw.mock.calls
      .map((c) => sqlTextOf(c[0]))
      .filter((text) => text.includes(LIVE_BANNER_CONDITION_B.sql));

    // Both public paths, and the assertion is against the shared
    // constant itself — a divergent copy could not satisfy it.
    //
    // The QUALIFIED form, because both statements now join the artwork
    // table and `is_active` alone would be ambiguous to read. It lives
    // beside its unqualified twin in one file, so a change to one that
    // misses the other shows up in a two-line diff.
    expect(withPredicate).toHaveLength(2);
  });

  it("binds values as parameters rather than interpolating them into SQL", async () => {
    const { service, queryRaw } = makeService();

    await service.listLive("PUBLIC_HOME", "ar-SA");

    const call = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(call.values).toContain("PUBLIC_HOME");
    // The literal never appears in the statement text — only a placeholder.
    expect(call.sql).not.toContain("'PUBLIC_HOME'");
  });

  it("never selects a raw object key into the public list", async () => {
    const { service, queryRaw } = makeService();

    await service.listLive("PUBLIC_HOME", "ar-SA");

    const sql = sqlTextOf(queryRaw.mock.calls[0][0]);
    // No storage key reaches the public list in ANY form. It used to
    // select one column and reduce it to a boolean; now it selects none
    // at all, because whether artwork exists is answered by the join
    // rather than by a flag.
    expect(sql).not.toContain("object_key");
    expect(sql).not.toContain("thumbnail_key");
  });

  it("returns a banner only when THIS language has artwork", async () => {
    const { service, queryRaw } = makeService();

    await service.listLive("PUBLIC_HOME", "ar-SA");

    const call = queryRaw.mock.calls[0][0] as Prisma.Sql;
    // An INNER join, not a LEFT one: a banner without artwork for the
    // requested language is absent rather than present-and-empty, and
    // there is no fallback to the other language anywhere.
    expect(call.sql).toContain("JOIN banner_images");
    expect(call.sql).not.toContain("LEFT JOIN");
    expect(call.values).toContain("ar-SA");
  });
});
