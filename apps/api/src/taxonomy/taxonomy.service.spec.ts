import { TaxonomyService } from "./taxonomy.service";

function fakeNodes(nodes: Array<{ id: string; parentId: string | null }>) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    taxonomyNode: {
      findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(byId.get(id) ?? null)
      ),
      update: jest.fn().mockResolvedValue({}),
    },
  } as never;
}

const auditStub = { log: jest.fn().mockResolvedValue(undefined) } as never;
const ctx = { actorId: "admin-1", requestId: "req-1" };

describe("TaxonomyService.move — cycle prevention", () => {
  it("rejects a node becoming its own parent", async () => {
    const prisma = fakeNodes([{ id: "a", parentId: null }]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("a", "a", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TAXONOMY_CYCLE_DETECTED" }),
    });
  });

  it("rejects moving a node under its direct child", async () => {
    // a -> b (b's parent is a). Moving a under b would create a 2-cycle.
    const prisma = fakeNodes([
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
    const prisma = fakeNodes([
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
    const prisma = fakeNodes([
      { id: "a", parentId: null },
      { id: "b", parentId: null },
    ]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("a", "b", ctx)).resolves.toBeDefined();
  });

  it("allows moving a node to root (no new parent)", async () => {
    const prisma = fakeNodes([{ id: "a", parentId: "b" }, { id: "b", parentId: null }]);
    const service = new TaxonomyService(prisma, auditStub);

    await expect(service.move("a", undefined, ctx)).resolves.toBeDefined();
  });
});
