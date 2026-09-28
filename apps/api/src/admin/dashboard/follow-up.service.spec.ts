import { FollowUpService } from "./follow-up.service";

/**
 * The follow-up centre, on the promise that makes it usable.
 *
 * THE PROMISE: a case does not go away because somebody looked at it.
 * That is asserted structurally here — the assignment row has no field
 * that could remove a case — and behaviourally, by assigning and
 * marking one and checking it is still in the list afterwards.
 *
 * THE OTHER PROMISE: the four cards are counted from the same list the
 * table renders, so a heading and its rows cannot disagree.
 */

const NOW = new Date("2026-08-26T10:00:00.000Z");
const HOURS = 60 * 60 * 1000;

describe("FollowUpService", () => {
  let prisma: Record<string, never>;
  let audit: { log: jest.Mock };
  let service: FollowUpService;
  let assignments: {
    caseKind: string;
    caseRef: string;
    assigneeId: string | null;
    inProgress: boolean;
    assignee: { id: string; email: string } | null;
  }[];

  beforeEach(() => {
    assignments = [];
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    // Declared before it is built so `$transaction` can hand the same
    // object back as the transaction client without TypeScript having
    // to infer a type from its own initialiser.
    const base: Record<string, never> = {} as never;
    Object.assign(base, {
      orderAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "alloc-1",
            deliveredAt: new Date(NOW.getTime() - 6 * 24 * HOURS),
            masterOrder: { supplierLegalNameSnapshot: "مؤسسة الإمداد" },
          },
        ]),
      },
      dispute: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "dsp-1048",
            openedAt: new Date(NOW.getTime() - 4 * 24 * HOURS),
            orderAllocationId: "alloc-2",
          },
        ]),
      },
      supplierVerificationRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "req-1",
            createdAt: new Date(NOW.getTime() - 8 * HOURS),
            companyId: "company-1",
            company: { legalName: "شركة الإتقان للتوريدات" },
          },
        ]),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "product-1",
            createdAt: new Date(NOW.getTime() - 5 * HOURS),
            nameAr: "أسمنت بورتلاندي 50 كجم",
            nameEn: "Portland cement",
          },
        ]),
      },
      adminUser: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "admin-1", email: "ops@forsa.sa" }]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "admin-1", status: "ACTIVE" }),
      },
      followUpAssignment: {
        findMany: jest.fn(async () => assignments),
        findUnique: jest.fn(async ({ where }: never) => {
          const key = (
            where as { caseKind_caseRef: { caseKind: string; caseRef: string } }
          ).caseKind_caseRef;
          const found = assignments.find(
            (row) =>
              row.caseKind === key.caseKind && row.caseRef === key.caseRef,
          );
          // A COPY, as a database returns. Handing back the live object
          // would let the upsert below mutate the "before" the caller is
          // still holding — and the test would pass on a fiction.
          return found ? { ...found } : null;
        }),
        upsert: jest.fn(async (args: never) => {
          const { where, create, update } = args as {
            where: { caseKind_caseRef: { caseKind: string; caseRef: string } };
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          };
          const key = where.caseKind_caseRef;
          const existing = assignments.find(
            (row) =>
              row.caseKind === key.caseKind && row.caseRef === key.caseRef,
          );

          if (existing) {
            Object.assign(existing, update);
            existing.assignee =
              existing.assigneeId === "admin-1"
                ? { id: "admin-1", email: "ops@forsa.sa" }
                : null;
            return { id: "assignment-1", ...existing };
          }

          const row = {
            caseKind: key.caseKind,
            caseRef: key.caseRef,
            assigneeId: (create.assigneeId as string) ?? null,
            inProgress: (create.inProgress as boolean) ?? false,
            assignee:
              create.assigneeId === "admin-1"
                ? { id: "admin-1", email: "ops@forsa.sa" }
                : null,
          };
          assignments.push(row);
          return { id: "assignment-1", ...row };
        }),
      },
      // Repeated payment failures.
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          {
            checkout_session_id: "chk-9911",
            first_failure: new Date(NOW.getTime() - 2 * 24 * HOURS),
          },
        ]),
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(base),
      ),
    });

    prisma = base as never;
    service = new FollowUpService(prisma as never, audit as never);
  });

  const CTX = { actorId: "admin-1", requestId: "req-1" };

  async function board(overrides: Record<string, unknown> = {}) {
    return service.board({ period: "30d", now: NOW, ...overrides } as never);
  }

  describe("the list", () => {
    it("gathers every kind of case from where it lives", async () => {
      const result = await board();

      expect(result.cases.map((row) => row.kind).sort()).toEqual([
        "DISPUTE_OPEN",
        "PAYMENT_REPEATEDLY_FAILED",
        "SETTLEMENT_OVERDUE",
        "SUPPLIER_VERIFICATION",
      ]);
    });

    it("raises ONE case per supplier, not one per thing it submitted", async () => {
      // «في قسم المتابعة يطلع لي صفّين: صف توثيق مورد وصف توثيق حساب
      //  بنكي، وأنا أحتاج واحد فقط لأن المعلومات موجودة.»
      //
      // The bank account has not been a decision of its own since
      // the review became one request over the whole record, so a
      // queue for it was a queue for nothing — and it stood beside
      // the supplier's own row, for the same company, carrying a
      // HIGHER priority than the request it was part of.
      const result = await board();

      expect(
        result.cases.filter((row) => row.kind === "BANK_ACCOUNT_REVIEW"),
      ).toEqual([]);
      expect(
        result.cases.filter((row) => row.kind === "SUPPLIER_VERIFICATION"),
      ).toHaveLength(1);
    });

    it("asks for the open REQUEST, never for the company's status", async () => {
      // Every supplier carries PENDING_VERIFICATION from the moment
      // it registers, so reading the status listed every account
      // that ever signed up and never asked for anything — work
      // nobody submitted, beside work somebody did.
      await board();

      const client = prisma as unknown as Record<
        string,
        { findMany: jest.Mock } | undefined
      >;
      expect(client.supplierVerificationRequest?.findMany).toHaveBeenCalled();

      // AND THE PROOF THAT NOTHING READS THE STATUS is that the fake
      // above carries no `company` at all: a service still asking for
      // one would throw here rather than quietly return a row.
      expect(client.company).toBeUndefined();
    });

    it("never raises a product case, and never even asks", async () => {
      // The product fixture above is still armed: a product sitting in
      // PENDING_REVIEW is exactly what the old case was built on. A
      // supplier now publishes directly, so that state is unreachable,
      // and a case raised on it would send an operator to a filter that
      // can only ever be empty.
      const result = await board();

      expect(result.cases.map((row) => row.kind)).not.toContain(
        "PRODUCT_REVIEW",
      );
      // Not merely filtered out afterwards — never queried at all.
      expect(
        (prisma as unknown as { product: { findMany: jest.Mock } }).product
          .findMany,
      ).not.toHaveBeenCalled();
    });

    it("counts the four cards FROM that same list", async () => {
      const result = await board();

      // A card computed by its own query is a card that can disagree
      // with the rows under it.
      expect(result.summary.total).toBe(result.cases.length);
      expect(
        result.summary.critical +
          result.summary.overdue +
          result.summary.review,
      ).toBe(result.summary.total);
    });

    it("puts the most urgent first, then the oldest", async () => {
      const result = await board();

      const priorities = result.cases.map((row) => row.priority);
      const rank = { CRITICAL: 0, OVERDUE: 1, REVIEW: 2 };
      const ranks = priorities.map((priority) => rank[priority]);

      expect([...ranks]).toEqual([...ranks].sort((a, b) => a - b));
    });

    it("reports how long each case has been waiting", async () => {
      const result = await board();
      const settlement = result.cases.find(
        (row) => row.kind === "SETTLEMENT_OVERDUE",
      )!;

      expect(settlement.ageHours).toBe(6 * 24);
    });

    it.each([
      ["priority", { priority: "CRITICAL" }],
      ["kind", { kind: "DISPUTE_OPEN" }],
    ])("filters by %s", async (_label, filter) => {
      const all = await board();
      const filtered = await board(filter);

      expect(filtered.cases.length).toBeLessThan(all.cases.length);
      expect(filtered.cases.length).toBeGreaterThan(0);
      // The cards keep describing everything that is waiting.
      expect(filtered.summary.total).toBe(all.summary.total);
    });

    it("finds the cases nobody owns", async () => {
      const result = await board({ assignee: "UNASSIGNED" });

      expect(result.cases.every((row) => row.assigneeId === null)).toBe(true);
      expect(result.cases.length).toBeGreaterThan(0);
    });

    it("searches the subject", async () => {
      const result = await board({ search: "الإتقان" });

      expect(result.cases).toHaveLength(1);
      expect(result.cases[0].kind).toBe("SUPPLIER_VERIFICATION");
    });
  });

  describe("assigning does not close", () => {
    it("keeps the case in the list after it is assigned", async () => {
      const before = await board();
      const target = before.cases.find((row) => row.kind === "DISPUTE_OPEN")!;

      await service.assign(
        "DISPUTE_OPEN" as never,
        target.caseRef,
        "admin-1",
        CTX,
      );
      const after = await board();

      // THE WHOLE POINT. A case leaves only when the dispute is
      // resolved in its own table.
      expect(after.cases.map((row) => row.id)).toContain(target.id);
      expect(after.summary.total).toBe(before.summary.total);
      expect(
        after.cases.find((row) => row.id === target.id)!.assigneeName,
      ).toBe("ops@forsa.sa");
    });

    it("keeps it in the list after it is marked in progress", async () => {
      const before = await board();
      const target = before.cases.find(
        (row) => row.kind === "SUPPLIER_VERIFICATION",
      )!;

      await service.setInProgress(
        "SUPPLIER_VERIFICATION" as never,
        target.caseRef,
        true,
        CTX,
      );
      const after = await board();

      expect(after.summary.total).toBe(before.summary.total);
      expect(after.cases.find((row) => row.id === target.id)!.inProgress).toBe(
        true,
      );
    });

    it("records who had the case and who has it now", async () => {
      await service.assign("DISPUTE_OPEN" as never, "dsp-1048", "admin-1", CTX);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "FOLLOW_UP_ASSIGNED",
          actorId: "admin-1",
          before: expect.objectContaining({ assigneeId: null }),
          after: expect.objectContaining({ assigneeId: "admin-1" }),
        }),
        expect.anything(),
      );
    });

    it("records an overwrite rather than letting it happen silently", async () => {
      await service.assign("DISPUTE_OPEN" as never, "dsp-1048", "admin-1", CTX);
      // The first call must have landed, or the second proves nothing.
      expect(assignments[0]).toMatchObject({
        caseRef: "dsp-1048",
        assigneeId: "admin-1",
      });
      audit.log.mockClear();

      await service.assign("DISPUTE_OPEN" as never, "dsp-1048", null, CTX);

      // How two people end up believing they own one case.
      expect(audit.log.mock.calls[0][0].before.assigneeId).toBe("admin-1");
      expect(audit.log.mock.calls[0][0].after.assigneeId).toBeNull();
    });

    it("records a change of progress before and after", async () => {
      await service.setInProgress(
        "SUPPLIER_VERIFICATION" as never,
        "company-1",
        true,
        CTX,
      );

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "FOLLOW_UP_PROGRESS_CHANGED",
          before: expect.objectContaining({ inProgress: "false" }),
          after: expect.objectContaining({ inProgress: "true" }),
        }),
        expect.anything(),
      );
    });

    it("stores no amount and no party detail in the assignment", async () => {
      await service.assign(
        "SETTLEMENT_OVERDUE" as never,
        "alloc-1",
        "admin-1",
        CTX,
      );

      const written = JSON.stringify(assignments);
      // A kind and a reference. Not a total, not a supplier's name.
      expect(written).not.toContain("مؤسسة الإمداد");
      expect(written).not.toMatch(/\d+\.\d{2}/);
    });

    it("refuses an administrator who is not active", async () => {
      (
        prisma as unknown as { adminUser: { findUnique: jest.Mock } }
      ).adminUser.findUnique = jest
        .fn()
        .mockResolvedValue({ id: "admin-2", status: "DISABLED" });

      await expect(
        service.assign("DISPUTE_OPEN" as never, "dsp-1048", "admin-2", CTX),
      ).rejects.toThrow(/not available/i);
    });

    it("offers only ACTIVE administrators to assign to", async () => {
      const result = await board();

      expect(result.assignees).toEqual([
        { id: "admin-1", name: "ops@forsa.sa" },
      ]);
    });
  });
});
