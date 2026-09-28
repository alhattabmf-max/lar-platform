import { AdminPoliciesService } from "./admin-policies.service";

/**
 * Authoring the legal documents, on the three rules that protect the
 * hundred and fifty-eight consents already recorded against them.
 *
 *   A PUBLISHED VERSION IS NEVER EDITED — people accepted that text.
 *   A VERSION IS NEVER DELETED — the acceptance row points at its id.
 *   ONE PUBLISHED VERSION PER DOCUMENT — otherwise the public viewer
 *   shows the terms twice and registration asks for two consents to one
 *   thing.
 */

const CTX = { actorId: "admin-1", requestId: "req-1" };
const LONG_AR = "نص سياسة طويل بما يكفي لتجاوز الحد الأدنى المطلوب.";
const LONG_EN = "A policy text long enough to clear the minimum length.";

describe("AdminPoliciesService", () => {
  let prisma: Record<string, never>;
  let audit: { log: jest.Mock };
  let service: AdminPoliciesService;
  let versions: Record<string, unknown>[];
  let documents: Record<string, unknown>[];
  let auditRows: Record<string, unknown>[];

  const version = (over: Record<string, unknown> = {}) => ({
    id: "v-1",
    policyDocumentId: "doc-1",
    versionLabel: "v1",
    textAr: LONG_AR,
    textEn: LONG_EN,
    isPublished: false,
    isMandatory: true,
    requiresReacceptance: false,
    publishedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    _count: { acceptances: 0 },
    policyDocument: { id: "doc-1", code: "terms_of_service" },
    ...over,
  });

  beforeEach(() => {
    auditRows = [];
    versions = [version()];
    documents = [
      { id: "doc-1", code: "terms_of_service", createdAt: new Date("2026-01-01") },
    ];
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const base: Record<string, never> = {} as never;
    Object.assign(base, {
      policyDocument: {
        findMany: jest.fn(async () =>
          documents.map((d) => ({
            ...d,
            versions: versions.filter((v) => v.policyDocumentId === d.id),
          })),
        ),
        findUnique: jest.fn(async ({ where }: never) => {
          const key = where as { id?: string; code?: string };
          return (
            documents.find(
              (d) => d.id === key.id || (key.code && d.code === key.code),
            ) ?? null
          );
        }),
        create: jest.fn(async ({ data }: never) => {
          const row = {
            id: `doc-${documents.length + 1}`,
            ...(data as object),
            createdAt: new Date(),
          };
          documents.push(row);
          return row;
        }),
      },
      policyVersion: {
        findUnique: jest.fn(async ({ where }: never) => {
          const found = versions.find((v) => v.id === (where as { id: string }).id);
          return found ? { ...found } : null;
        }),
        create: jest.fn(async ({ data }: never) => {
          const row = version({
            id: `v-${versions.length + 1}`,
            ...(data as object),
          });
          versions.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: never) => {
          const found = versions.find(
            (v) => v.id === (where as { id: string }).id,
          )!;
          Object.assign(found, data as object);
          return { ...found };
        }),
        updateMany: jest.fn(async ({ where, data }: never) => {
          const w = where as { policyDocumentId: string; isPublished: boolean };
          const hit = versions.filter(
            (v) =>
              v.policyDocumentId === w.policyDocumentId &&
              v.isPublished === w.isPublished,
          );
          for (const row of hit) Object.assign(row, data as object);
          return { count: hit.length };
        }),
        // TWO CALLERS, TWO SHAPES: readiness counts by
        // {isPublished, isMandatory}, publish counts by
        // {policyDocumentId, isPublished}. Matching only the keys the
        // caller actually passed is what keeps one mock honest for both
        // — an earlier version compared `isMandatory` against undefined
        // and returned zero for the publish path.
        count: jest.fn(async ({ where }: never) => {
          const w = where as Record<string, unknown>;
          return versions.filter((v) =>
            Object.entries(w).every(([key, value]) => v[key] === value),
          ).length;
        }),
      },
      auditLog: {
        create: jest.fn(async ({ data }: never) => {
          auditRows.push(data as Record<string, unknown>);
          return data;
        }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(base),
      ),
    });

    prisma = base as never;
    service = new AdminPoliciesService(prisma as never, audit as never);
  });

  const write = (over: Record<string, unknown> = {}) => ({
    versionLabel: "v2",
    textAr: LONG_AR,
    textEn: LONG_EN,
    isMandatory: true,
    requiresReacceptance: false,
    ...over,
  });

  describe("writing", () => {
    it("creates a version as a DRAFT, never published", async () => {
      const created = await service.createVersion("doc-1", write(), CTX);

      // Writing text and putting it in force are two decisions, so they
      // are two acts with two audit entries.
      expect(created.isPublished).toBe(false);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "POLICY_VERSION_DRAFTED" }),
      );
    });

    it("REFUSES to edit a published version", async () => {
      versions[0].isPublished = true;

      await expect(
        service.updateVersion("v-1", write(), CTX),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("REFUSES to edit a version somebody has accepted", async () => {
      versions[0]._count = { acceptances: 3 };

      // A draft should never have acceptances. If one ever does, its
      // text is what somebody agreed to.
      await expect(
        service.updateVersion("v-1", write(), CTX),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("edits a draft nobody has accepted", async () => {
      const updated = await service.updateVersion(
        "v-1",
        write({ versionLabel: "v1-fixed" }),
        CTX,
      );

      expect(updated.versionLabel).toBe("v1-fixed");
    });

    it.each([
      ["an empty Arabic text", { textAr: "" }],
      ["an empty English text", { textEn: "" }],
      ["a text below the minimum", { textAr: "قصير" }],
      ["no version label", { versionLabel: "" }],
    ])("refuses %s", async (_label, over) => {
      await expect(
        service.createVersion("doc-1", write(over), CTX),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("requires BOTH languages, because the viewer has no fallback", async () => {
      // A version published with one side empty is a policy that does
      // not exist for half the audience.
      await expect(
        service.createVersion("doc-1", write({ textEn: "" }), CTX),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("publishing", () => {
    it("publishes without touching what came before", async () => {
      versions[0].isPublished = true;
      versions.push(version({ id: "v-2", versionLabel: "v2" }));

      await service.publish("v-2", CTX);

      // The new version is published. The old one STAYS published,
      // because the database will not let it be touched — so the
      // question "which is in force" is answered by the reader taking
      // the newest, not by this service withdrawing the old.
      expect(versions.find((v) => v.id === "v-2")!.isPublished).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("records how many versions were already in force", async () => {
      versions[0].isPublished = true;
      versions.push(version({ id: "v-2" }));

      await service.publish("v-2", CTX);

      const entry = auditRows.find(
        (row) => row.action === "POLICY_VERSION_PUBLISHED",
      )!;
      // How many published versions the document already had, so the
      // entry says whether this replaced something or was the first.
      expect(
        (entry.afterData as { previouslyPublishedVersions: number })
          .previouslyPublishedVersions,
      ).toBe(1);
    });

    it("stamps the date it came into force", async () => {
      const published = await service.publish("v-1", CTX);

      expect(published.isPublished).toBe(true);
      expect(published.publishedAt).toBeInstanceOf(Date);
    });

    it("refuses to publish what is already published", async () => {
      versions[0].isPublished = true;

      await expect(service.publish("v-1", CTX)).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe("withdrawing is not possible at all", () => {
    it("exposes no unpublish, withdraw or archive method", () => {
      // NOT AN OMISSION — the database refuses it. A trigger on
      // `policy_versions` raises «cannot modify a published policy
      // version» on ANY update to a published row, and on any delete of
      // one. An endpoint for it could only ever answer 500, which is
      // worse than not offering the control.
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      expect(
        methods.filter((m) => /unpublish|withdraw|archive/i.test(m)),
      ).toEqual([]);
    });

    it("keeps an earlier published version, published", async () => {
      versions[0].isPublished = true;
      versions[0].publishedAt = new Date("2026-03-01T00:00:00.000Z");
      versions.push(version({ id: "v-2", versionLabel: "v2" }));

      await service.publish("v-2", CTX);

      // Both stay published, permanently. WHICH ONE IS IN FORCE is a
      // read-side question — the newest — and the older row keeps its
      // text, its date and the acceptances recorded against it.
      const first = versions.find((v) => v.id === "v-1")!;
      expect(first.isPublished).toBe(true);
      expect(first.publishedAt).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    });
  });

  describe("there is no way to delete a version", () => {
    it("exposes no delete method at all", () => {
      // `policy_acceptances` points at a version id. Removing a version
      // leaves every consent record pointing at nothing — so the method
      // does not exist, rather than existing behind a guard.
      const methods = Object.getOwnPropertyNames(
        Object.getPrototypeOf(service),
      );
      expect(methods.filter((m) => /delete|remove|destroy/i.test(m))).toEqual([]);
    });
  });

  describe("whether anyone can register", () => {
    it("reports the platform closed when no mandatory policy is live", async () => {
      const readiness = await service.registrationReadiness();

      // `assertMandatoryPoliciesAccepted` refuses registration outright
      // in this state. Saying so here means an operator learns it from
      // the screen that causes it, not from a support ticket.
      expect(readiness).toEqual({
        mandatoryPublished: 0,
        registrationOpen: false,
      });
    });

    it("reports it open once one is", async () => {
      versions[0].isPublished = true;

      expect(await service.registrationReadiness()).toEqual({
        mandatoryPublished: 1,
        registrationOpen: true,
      });
    });
  });

  describe("documents", () => {
    it("refuses a code that is not a slug", async () => {
      await expect(
        service.createDocument("Terms Of Service!", CTX),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("refuses a duplicate code", async () => {
      await expect(
        service.createDocument("terms_of_service", CTX),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("normalises the code it stores", async () => {
      const created = await service.createDocument("  Refund_Policy  ", CTX);

      // The code is the public anchor. It gets into an address bar.
      expect(created.code).toBe("refund_policy");
    });
  });

  describe("reading", () => {
    it("reports how many people accepted each version", async () => {
      versions[0]._count = { acceptances: 158 };

      const [document] = await service.list();

      // The reason a version cannot be deleted, on the screen rather
      // than only in a comment.
      expect(document.versions[0].acceptanceCount).toBe(158);
    });
  });
});
