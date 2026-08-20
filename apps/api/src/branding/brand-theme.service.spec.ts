import { DEFAULT_BRAND_THEME, type BrandThemeColors } from "@platform/types";
import { ACTIVE_THEME_KEY, BrandThemeService, DRAFT_THEME_KEY } from "./brand-theme.service";
import type { PrismaService } from "../database/prisma.service";
import type { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";

const VALID: BrandThemeColors = {
  primary: "#123456",
  secondary: "#0F766E",
  accent: "#F59E0B",
  accentInteractive: "#B45309",
};

/** A theme whose accent is unreadable against the fixed primary text. */
const LOW_CONTRAST: BrandThemeColors = { ...DEFAULT_BRAND_THEME, accent: "#1E293B" };

interface Rows {
  [key: string]: { value: unknown; updatedAt: Date } | null;
}

function makeService(rows: Rows = {}) {
  const store: Rows = { ...rows };

  const findUnique = jest.fn(async ({ where }: { where: { key: string } }) => store[where.key] ?? null);
  const upsert = jest.fn(async ({ where, create, update }: {
    where: { key: string };
    create: { value: unknown };
    update: { value: unknown };
  }) => {
    const value = store[where.key] ? update.value : create.value;
    store[where.key] = { value, updatedAt: new Date("2026-08-20T00:00:00Z") };
    return store[where.key];
  });
  const deleteMany = jest.fn(async ({ where }: { where: { key: string } }) => {
    delete store[where.key];
    return { count: 1 };
  });

  const client = { systemSetting: { findUnique, upsert, deleteMany } };
  const prisma = {
    ...client,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  } as unknown as PrismaService;

  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return { service: new BrandThemeService(prisma, audit), store, audit, findUnique, upsert, prisma };
}

const CTX = { actorId: "admin-1", requestId: "req-1" };

describe("getActive", () => {
  it("returns the defaults when nothing is configured", async () => {
    const { service } = makeService();
    await expect(service.getActive()).resolves.toEqual(DEFAULT_BRAND_THEME);
  });

  it("returns the stored active theme", async () => {
    const { service } = makeService({
      [ACTIVE_THEME_KEY]: { value: VALID, updatedAt: new Date() },
    });
    await expect(service.getActive()).resolves.toEqual(VALID);
  });

  it("falls back to the defaults on a corrupt stored value", async () => {
    const { service } = makeService({
      [ACTIVE_THEME_KEY]: { value: { primary: "not-a-colour" }, updatedAt: new Date() },
    });
    await expect(service.getActive()).resolves.toEqual(DEFAULT_BRAND_THEME);
  });

  it("falls back to the defaults when the database read fails", async () => {
    const { service, findUnique } = makeService();
    findUnique.mockRejectedValueOnce(new Error("connection refused"));

    await expect(service.getActive()).resolves.toEqual(DEFAULT_BRAND_THEME);
  });

  it("never exposes the draft", async () => {
    const { service } = makeService({
      [DRAFT_THEME_KEY]: { value: VALID, updatedAt: new Date() },
    });

    await expect(service.getActive()).resolves.toEqual(DEFAULT_BRAND_THEME);
  });
});

describe("saveDraft", () => {
  it("stores a normalised draft and returns its validation", async () => {
    const { service, store, audit } = makeService();

    const draft = await service.saveDraft(
      { ...VALID, primary: "#123456".toLowerCase() },
      CTX
    );

    expect(draft.colors.primary).toBe("#123456");
    expect(draft.validation.valid).toBe(true);
    expect(store[DRAFT_THEME_KEY]!.value).toEqual(VALID);
    expect(store[ACTIVE_THEME_KEY]).toBeUndefined();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "BRAND_THEME_DRAFT_SAVED" })
    );
  });

  it("rejects a malformed hex outright — format failures are never stored", async () => {
    const { service, store } = makeService();

    await expect(service.saveDraft({ ...VALID, primary: "var(--x)" }, CTX)).rejects.toBeInstanceOf(
      BusinessException
    );
    expect(store[DRAFT_THEME_KEY]).toBeUndefined();
  });

  it("SAVES a contrast-failing draft so the admin screen can show the problem", async () => {
    const { service, store } = makeService();

    const draft = await service.saveDraft(LOW_CONTRAST, CTX);

    expect(draft.validation.valid).toBe(false);
    expect(draft.validation.issues.some((i) => i.code === "ACCENT_ON_PRIMARY_TEXT")).toBe(true);
    expect(store[DRAFT_THEME_KEY]!.value).toEqual(LOW_CONTRAST);
  });

  it("does not touch the active theme", async () => {
    const { service, store } = makeService({
      [ACTIVE_THEME_KEY]: { value: DEFAULT_BRAND_THEME, updatedAt: new Date() },
    });

    await service.saveDraft(VALID, CTX);

    expect(store[ACTIVE_THEME_KEY]!.value).toEqual(DEFAULT_BRAND_THEME);
  });
});

describe("publish", () => {
  it("promotes a valid draft to active", async () => {
    const { service, store, audit } = makeService({
      [DRAFT_THEME_KEY]: { value: VALID, updatedAt: new Date() },
    });

    await expect(service.publish(CTX)).resolves.toEqual(VALID);
    expect(store[ACTIVE_THEME_KEY]!.value).toEqual(VALID);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "BRAND_THEME_PUBLISHED" })
    );
  });

  it("runs read-validate-write inside exactly one transaction", async () => {
    const { service, prisma, upsert } = makeService({
      [DRAFT_THEME_KEY]: { value: VALID, updatedAt: new Date() },
    });
    const transaction = (prisma as unknown as { $transaction: jest.Mock }).$transaction;

    await service.publish(CTX);

    // One transaction, and the active-theme write happened while it was
    // open — so a concurrent draft save cannot land between the
    // validation and the write.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.invocationCallOrder[0]).toBeGreaterThan(
      transaction.mock.invocationCallOrder[0]
    );
  });

  it("REFUSES a contrast-failing draft", async () => {
    const { service, store } = makeService({
      [DRAFT_THEME_KEY]: { value: LOW_CONTRAST, updatedAt: new Date() },
    });

    await expect(service.publish(CTX)).rejects.toBeInstanceOf(BusinessException);
    expect(store[ACTIVE_THEME_KEY]).toBeUndefined();
  });

  it("REFUSES a format-corrupt draft", async () => {
    const { service, store } = makeService({
      [DRAFT_THEME_KEY]: { value: { primary: "red" }, updatedAt: new Date() },
    });

    await expect(service.publish(CTX)).rejects.toBeInstanceOf(BusinessException);
    expect(store[ACTIVE_THEME_KEY]).toBeUndefined();
  });

  it("refuses when there is no draft at all", async () => {
    const { service } = makeService();
    await expect(service.publish(CTX)).rejects.toBeInstanceOf(BusinessException);
  });

  it("leaves the previous active theme untouched when it refuses", async () => {
    const { service, store } = makeService({
      [ACTIVE_THEME_KEY]: { value: VALID, updatedAt: new Date() },
      [DRAFT_THEME_KEY]: { value: LOW_CONTRAST, updatedAt: new Date() },
    });

    await expect(service.publish(CTX)).rejects.toBeInstanceOf(BusinessException);
    expect(store[ACTIVE_THEME_KEY]!.value).toEqual(VALID);
  });
});

describe("reset", () => {
  it("restores the defaults and clears the draft", async () => {
    const { service, store, audit } = makeService({
      [ACTIVE_THEME_KEY]: { value: VALID, updatedAt: new Date() },
      [DRAFT_THEME_KEY]: { value: LOW_CONTRAST, updatedAt: new Date() },
    });

    await expect(service.reset(CTX)).resolves.toEqual(DEFAULT_BRAND_THEME);
    expect(store[ACTIVE_THEME_KEY]!.value).toEqual(DEFAULT_BRAND_THEME);
    expect(store[DRAFT_THEME_KEY]).toBeUndefined();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "BRAND_THEME_RESET" })
    );
  });

  it("works when nothing was configured", async () => {
    const { service, store } = makeService();

    await expect(service.reset(CTX)).resolves.toEqual(DEFAULT_BRAND_THEME);
    expect(store[ACTIVE_THEME_KEY]!.value).toEqual(DEFAULT_BRAND_THEME);
  });
});

describe("getAdminView", () => {
  it("exposes active, draft, defaults and both validations", async () => {
    const { service } = makeService({
      [ACTIVE_THEME_KEY]: { value: VALID, updatedAt: new Date() },
      [DRAFT_THEME_KEY]: { value: LOW_CONTRAST, updatedAt: new Date("2026-08-20T00:00:00Z") },
    });

    const view = await service.getAdminView();

    expect(view.active).toEqual(VALID);
    expect(view.defaults).toEqual(DEFAULT_BRAND_THEME);
    expect(view.draft!.colors).toEqual(LOW_CONTRAST);
    expect(view.draft!.validation.valid).toBe(false);
    expect(view.activeValidation.valid).toBe(true);
  });

  it("reports a null draft when none is saved", async () => {
    const { service } = makeService();
    await expect(service.getAdminView()).resolves.toMatchObject({ draft: null });
  });
});

describe("audit", () => {
  it("writes an entry for every mutation", async () => {
    const { service, audit } = makeService();

    await service.saveDraft(VALID, CTX);
    await service.publish(CTX);
    await service.reset(CTX);

    const actions = (audit.log as jest.Mock).mock.calls.map((c) => c[0].action);
    expect(actions).toEqual([
      "BRAND_THEME_DRAFT_SAVED",
      "BRAND_THEME_PUBLISHED",
      "BRAND_THEME_RESET",
    ]);
    for (const call of (audit.log as jest.Mock).mock.calls) {
      expect(call[0].entityType).toBe("system_setting");
      expect(call[0].actorType).toBe("ADMIN");
    }
  });
});
