import { PrismaClient } from "@prisma/client";
import { runOpportunityLifecycleSweep } from "@platform/opportunity-lifecycle";
import { buildSharedContext, seedOpportunity } from "./fixtures";

describe("Two concurrent worker processes racing the same sweep — no duplicate processing (integration, real DB)", () => {
  // Two SEPARATE PrismaClient instances, deliberately — simulating
  // two independent worker PROCESSES, each with their own DB
  // connection, both triggering a sweep pass at the same moment. This
  // is exactly the scenario FOR UPDATE SKIP LOCKED exists to make
  // safe: neither process coordinates with the other except through
  // row locks at the database level.
  const prismaA = new PrismaClient();
  const prismaB = new PrismaClient();

  afterAll(async () => {
    await prismaA.$disconnect();
    await prismaB.$disconnect();
  });

  it("running the sweep on two connections at the same time never double-transitions or double-audits the same rows", async () => {
    const ctx = await buildSharedContext(prismaA);

    const ids = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        seedOpportunity(prismaA, ctx, {
          status: i % 2 === 0 ? "ACTIVE" : "PAUSED",
          targetQuantity: 40,
          fundedQuantity: 10,
          startAt: new Date(Date.now() - 3 * 3600_000),
          endAt: new Date(Date.now() - 1000), // all past their end date -> EXPIRED candidates
        })
      )
    );

    const [resultA, resultB] = await Promise.all([
      runOpportunityLifecycleSweep(prismaA),
      runOpportunityLifecycleSweep(prismaB),
    ]);

    // Combined, exactly 30 rows were transitioned once each across
    // both concurrent calls — never 0 (lost) and never more than 30
    // (double-counted), regardless of how the race split between them.
    const totalExpired = resultA.expiredFromActive + resultA.expiredFromPaused + resultB.expiredFromActive + resultB.expiredFromPaused;
    expect(totalExpired).toBe(30);

    for (const id of ids) {
      const row = await prismaA.opportunity.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("EXPIRED");
      expect(row.fundedQuantity).toBe(10); // untouched by either racing call

      const auditCount = await prismaA.auditLog.count({ where: { entityId: id, action: "OPPORTUNITY_EXPIRED" } });
      expect(auditCount).toBe(1); // never duplicated across the two racing sweeps

      const allOutbox = await prismaA.outboxEvent.findMany({ where: { eventType: "OPPORTUNITY_EXPIRED" } });
      const relevant = allOutbox.filter((e) => (e.payload as Record<string, unknown>).opportunityId === id);
      expect(relevant.length).toBe(1);
    }
  }, 30_000);
});
