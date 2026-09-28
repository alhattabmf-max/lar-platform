import { MasterOrderStatus, DisputeStatus } from "@prisma/client";
import {
  isTroubled,
  orderStage,
  KNOWN_ORDER_STATUSES,
  RESOLVED_DISPUTE_STATUSES,
} from "./order-stage";

/**
 * Two fulfilment statuses becoming four screen stages.
 *
 * THE RISK THIS PINS DOWN: a status added to the enum later that this
 * mapper does not know would fall into whichever branch happens to be
 * last, and appear on screen under a heading that is wrong. The first
 * test fails the moment that happens.
 */

const CLEAN = {
  hasOpenDispute: false,
  hasFailedRefund: false,
  hasOverduePreparation: false,
};

describe("the mapper knows every status the database can hold", () => {
  it("covers `MasterOrderStatus` exactly", () => {
    // Adding a value to the enum without deciding which stage it shows
    // in fails HERE, in a test, rather than silently on screen.
    expect([...KNOWN_ORDER_STATUSES].sort()).toEqual(
      Object.values(MasterOrderStatus).sort(),
    );
  });

  it("treats every dispute status as either resolved or open", () => {
    const all = Object.values(DisputeStatus);
    const resolved = [...RESOLVED_DISPUTE_STATUSES];

    // Written as the RESOLVED list so a new resolution kind added later
    // is treated as open — visible and dealt with — rather than quietly
    // vanishing from the count.
    expect(
      resolved.every((status) => all.includes(status as DisputeStatus)),
    ).toBe(true);
    expect(
      all.filter((status) => !resolved.includes(status as never)).length,
    ).toBeGreaterThan(0);
  });
});

describe("orderStage", () => {
  it("puts a plain fulfilled order in completed", () => {
    expect(orderStage({ status: "FULFILLED", ...CLEAN })).toBe("completed");
  });

  it("puts a plain in-flight order in fulfilment", () => {
    expect(orderStage({ status: "IN_FULFILLMENT", ...CLEAN })).toBe(
      "inFulfilment",
    );
  });

  describe("troubled wins over everything", () => {
    it.each([
      ["an open dispute", { hasOpenDispute: true }],
      ["a refund that failed for good", { hasFailedRefund: true }],
      ["preparation past its deadline", { hasOverduePreparation: true }],
    ])("moves a FULFILLED order out of completed for %s", (_label, flag) => {
      // Deciding otherwise would hide a disputed order inside
      // "completed", where nobody is looking for it.
      expect(orderStage({ status: "FULFILLED", ...CLEAN, ...flag })).toBe(
        "troubled",
      );
    });

    it.each([
      ["an open dispute", { hasOpenDispute: true }],
      ["a refund that failed for good", { hasFailedRefund: true }],
      ["preparation past its deadline", { hasOverduePreparation: true }],
    ])(
      "moves an IN_FULFILLMENT order out of in-fulfilment for %s",
      (_label, flag) => {
        expect(
          orderStage({ status: "IN_FULFILLMENT", ...CLEAN, ...flag }),
        ).toBe("troubled");
      },
    );
  });

  it("is troubled on ANY of the three, not all of them", () => {
    expect(isTroubled({ status: "FULFILLED", ...CLEAN })).toBe(false);
    expect(
      isTroubled({ status: "FULFILLED", ...CLEAN, hasOpenDispute: true }),
    ).toBe(true);
    expect(
      isTroubled({
        status: "FULFILLED",
        hasOpenDispute: true,
        hasFailedRefund: true,
        hasOverduePreparation: true,
      }),
    ).toBe(true);
  });
});

describe("the three stages partition the total", () => {
  /** Every combination of status and the three trouble flags. */
  const universe = Object.values(MasterOrderStatus).flatMap((status) =>
    [true, false].flatMap((dispute) =>
      [true, false].flatMap((refund) =>
        [true, false].map((overdue) => ({
          status,
          hasOpenDispute: dispute,
          hasFailedRefund: refund,
          hasOverduePreparation: overdue,
        })),
      ),
    ),
  );

  it("gives every possible order exactly one stage", () => {
    for (const order of universe) {
      const stage = orderStage(order);
      expect(["inFulfilment", "completed", "troubled"]).toContain(stage);
    }
  });

  it("never places an order in `paid`, which is the total and not a stage", () => {
    // `paid` is every order in the period, because `master_orders`
    // cannot be written without a successful payment. The other three
    // partition that same total; an order counted in `paid` AND in one
    // of them is not double counting — it is the whole and one part.
    for (const order of universe) {
      expect(orderStage(order)).not.toBe("paid");
    }
  });

  it("counts each order once across the three", () => {
    const counts = { inFulfilment: 0, completed: 0, troubled: 0 };
    for (const order of universe) {
      counts[orderStage(order) as keyof typeof counts] += 1;
    }

    expect(counts.inFulfilment + counts.completed + counts.troubled).toBe(
      universe.length,
    );
  });
});
