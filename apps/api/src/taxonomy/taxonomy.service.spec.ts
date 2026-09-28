import { TaxonomyService } from "./taxonomy.service";

/**
 * A tree, as the service reads it.
 *
 * IT ANSWERS EVERY CALL THE SERVICE MAKES, not only the ones the
 * first case needed: `findMany` for a node's children, `count` for
 * what would block a delete, `delete` for the row itself. A stub that
 * answered a subset would fail on a path nobody meant to test and
 * send somebody looking for a bug in the service.
 */
function fakeNodes(
  nodes: Array<{ id: string; parentId: string | null }>,
  productsUnder: Record<string, number> = {}
) {
  const byId = new Map(
    nodes.map((n) => [n.id, { nameAr: "اسم", nameEn: "Name", ...n }])
  );
  const deleted: string[] = [];

  const childrenOf = (parents: string[]) =>
    nodes.filter((n) => n.parentId !== null && parents.includes(n.parentId));

  const prisma = {
    taxonomyNode: {
      findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(byId.get(id) ?? null)
      ),
      findMany: jest.fn(
        ({ where }: { where: { parentId: { in: string[] } | string } }) => {
          const parents =
            typeof where.parentId === "string"
              ? [where.parentId]
              : where.parentId.in;
          return Promise.resolve(childrenOf(parents));
        }
      ),
      count: jest.fn(({ where }: { where: { parentId: string } }) =>
        Promise.resolve(childrenOf([where.parentId]).length)
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "created", ...data })
      ),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn(({ where: { id } }: { where: { id: string } }) => {
        deleted.push(id);
        return Promise.resolve({});
      }),
    },
    product: {
      count: jest.fn(({ where }: { where: { taxonomyNodeId: string } }) =>
        Promise.resolve(productsUnder[where.taxonomyNodeId] ?? 0)
      ),
    },
    // The service reads the two counts together; the real client
    // takes the promises already started.
    $transaction: jest.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations)
    ),
  };

  return { prisma: prisma as never, deleted };
}

const auditStub = { log: jest.fn().mockResolvedValue(undefined) } as never;
const ctx = { actorId: "admin-1", requestId: "req-1" };

describe("TaxonomyService.move — cycle prevention", () => {
  it("rejects a node becoming its own parent", async () => {
    const { prisma } = fakeNodes([{ id: "a", parentId: null }]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("a", "a", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TAXONOMY_CYCLE_DETECTED" }),
    });
  });

  it("rejects moving a node under its direct child", async () => {
    // a -> b (b's parent is a). Moving a under b would create a 2-cycle.
    const { prisma } = fakeNodes([
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
    ]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("a", "b", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TAXONOMY_CYCLE_DETECTED" }),
    });
  });

  it("rejects moving a node under a distant (3+ levels) descendant", async () => {
    // a -> b -> c -> d. Moving a under d must be rejected.
    const { prisma } = fakeNodes([
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
      { id: "d", parentId: "c" },
    ]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("a", "d", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TAXONOMY_CYCLE_DETECTED" }),
    });
  });

  it("allows moving a node under an unrelated node", async () => {
    const { prisma } = fakeNodes([
      { id: "a", parentId: null },
      { id: "b", parentId: null },
    ]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("a", "b", ctx)).resolves.toBeDefined();
  });

  it("allows moving a node to root (no new parent)", async () => {
    const { prisma } = fakeNodes([{ id: "a", parentId: "b" }, { id: "b", parentId: null }]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("a", undefined, ctx)).resolves.toBeDefined();
  });
});

describe("a main category and two levels beneath it", () => {
  it("lets a branch be created under a main category", async () => {
    const { prisma } = fakeNodes([{ id: "root", parentId: null }]);
    const service = new TaxonomyService(prisma, auditStub);

    // Level 2. Nothing to refuse.
    await expect(
      service.create({ parentId: "root", nameAr: "الهواتف", nameEn: "Phones" } as never, ctx)
    ).resolves.toBeDefined();
  });

  it("lets a branch be created under a branch", async () => {
    const { prisma } = fakeNodes([
      { id: "root", parentId: null },
      { id: "level2", parentId: "root" },
    ]);
    const service = new TaxonomyService(prisma, auditStub);

    // Level 3 — the deepest allowed.
    await expect(
      service.create({ parentId: "level2", nameAr: "ذكية", nameEn: "Smart" } as never, ctx)
    ).resolves.toBeDefined();
  });

  it("refuses a fourth level", async () => {
    const { prisma } = fakeNodes([
      { id: "root", parentId: null },
      { id: "level2", parentId: "root" },
      { id: "level3", parentId: "level2" },
    ]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(
      service.create({ parentId: "level3", nameAr: "أعمق", nameEn: "Deeper" } as never, ctx)
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TAXONOMY_TOO_DEEP" }),
    });
  });

  it("puts no limit on how many main categories there are", async () => {
    const { prisma } = fakeNodes([{ id: "root", parentId: null }]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(
      service.create({ nameAr: "قسم آخر", nameEn: "Another" } as never, ctx)
    ).resolves.toBeDefined();
  });

  it("refuses a MOVE that would push a branch past the third level", async () => {
    // `spare` has a child, so moving it under level2 would land its
    // child at level 4 even though `spare` itself would sit at 3.
    const { prisma } = fakeNodes([
      { id: "root", parentId: null },
      { id: "level2", parentId: "root" },
      { id: "spare", parentId: null },
      { id: "spareChild", parentId: "spare" },
    ]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("spare", "level2", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TAXONOMY_TOO_DEEP" }),
    });
  });

  it("allows a MOVE that fits", async () => {
    const { prisma } = fakeNodes([
      { id: "root", parentId: null },
      { id: "level2", parentId: "root" },
      { id: "leaf", parentId: null },
    ]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("leaf", "level2", ctx)).resolves.toBeDefined();
  });
});

describe("removing a category", () => {
  it("removes one nothing depends on", async () => {
    const { prisma, deleted } = fakeNodes([{ id: "leaf", parentId: null }]);
    const service = new TaxonomyService(prisma, auditStub);

    await service.remove("leaf", ctx);
    expect(deleted).toEqual(["leaf"]);
  });

  it("refuses one with sub-categories, and says how many", async () => {
    // `taxonomy_nodes.parent_id` is ON DELETE SET NULL: the database
    // would delete the parent and quietly promote every branch under
    // it to a main category.
    const { prisma, deleted } = fakeNodes([
      { id: "root", parentId: null },
      { id: "a", parentId: "root" },
      { id: "b", parentId: "root" },
    ]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.remove("root", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TAXONOMY_HAS_CHILDREN" }),
    });
    expect(deleted).toEqual([]);
  });

  it("refuses one products are classified under", async () => {
    const { prisma, deleted } = fakeNodes(
      [{ id: "leaf", parentId: null }],
      { leaf: 4 }
    );
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.remove("leaf", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TAXONOMY_HAS_PRODUCTS" }),
    });
    expect(deleted).toEqual([]);
  });

  it("records the name, so the line survives the row", async () => {
    const log = jest.fn().mockResolvedValue(undefined);
    const { prisma } = fakeNodes([{ id: "leaf", parentId: null }]);
    const service = new TaxonomyService(prisma, { log } as never);

    await service.remove("leaf", ctx);

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TAXONOMY_NODE_DELETED",
        entityId: "leaf",
        before: expect.objectContaining({ nameAr: expect.anything() }),
      })
    );
  });
});
