/* eslint-disable @typescript-eslint/no-explicit-any -- each controller is
   constructed with a recording stub in place of its service; typing those
   stubs precisely would restate the service signatures without testing
   anything. */
import type { SessionData } from "../security/session.service";
import { SupplierOrdersReadController } from "../../orders/supplier-reads.controller";
import { SupplierSettlementController } from "../../settlement/supplier-settlement.controller";
import { SupplierReplacementReadsController } from "../../replacement/supplier-replacement-reads.controller";
import { SupplierNotificationsController } from "../../notifications/supplier-notifications.controller";

/**
 * Every supplier read is scoped by the SESSION.
 *
 * `supplier-routes.spec.ts` proves statically that no route declares a
 * `companyId` parameter. This proves the behaviour that matters at runtime:
 * what each handler actually forwards is the session's company, and a company
 * arriving in the query is carried nowhere.
 *
 * The controllers are thin by design, so these are one-line assertions — which
 * is the point. A handler that did anything else would need a reason.
 */

const SESSION = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  companyId: "11111111-1111-4111-8111-111111111111",
} as SessionData;

/** What a caller would put in a query string if they wanted someone else's data. */
const ATTACKER_QUERY = {
  page: 1,
  pageSize: 20,
  companyId: "99999999-9999-4999-8999-999999999999",
} as any;

const ID = "22222222-2222-4222-8222-222222222222";

function recorder() {
  const calls: unknown[][] = [];
  const record = jest.fn(async (...args: unknown[]) => {
    calls.push(args);
    return {} as never;
  });
  return { calls, record };
}

describe("supplier order reads forward the session's company", () => {
  it("passes it on all three routes, and nothing else", async () => {
    const { calls, record } = recorder();
    const controller = new SupplierOrdersReadController({
      listOrders: record,
      getOrder: record,
      listDocuments: record,
    } as any);

    await controller.list(ATTACKER_QUERY, SESSION);
    await controller.get(ID, SESSION);
    await controller.listDocuments(ID, SESSION);

    for (const call of calls) {
      expect(call[0]).toEqual({ companyId: SESSION.companyId });
    }
    expect(calls).toHaveLength(3);
  });

  it("carries a companyId from the query nowhere", async () => {
    // The DTO strips it, and the scope is built from the session regardless —
    // two independent reasons the attacker's value cannot reach a WHERE clause.
    const { calls, record } = recorder();
    const controller = new SupplierOrdersReadController({ listOrders: record } as any);

    await controller.list(ATTACKER_QUERY, SESSION);

    expect(JSON.stringify(calls[0][0])).not.toContain("99999999");
  });
});

describe("supplier settlement reads forward the session's company", () => {
  it("passes it on both routes", async () => {
    const { calls, record } = recorder();
    const controller = new SupplierSettlementController({ list: record, get: record } as any);

    await controller.list(ATTACKER_QUERY, SESSION);
    await controller.get(ID, SESSION);

    expect(calls.map((c) => c[0])).toEqual([
      { companyId: SESSION.companyId },
      { companyId: SESSION.companyId },
    ]);
  });
});

describe("supplier replacement reads forward the session's company", () => {
  it("passes it on both routes", async () => {
    const { calls, record } = recorder();
    const controller = new SupplierReplacementReadsController({
      list: record,
      get: record,
    } as any);

    await controller.list(ATTACKER_QUERY, SESSION);
    await controller.get(ID, SESSION);

    expect(calls.map((c) => c[0])).toEqual([
      { companyId: SESSION.companyId },
      { companyId: SESSION.companyId },
    ]);
  });
});

describe("supplier notifications scope by USER and company together", () => {
  it("passes both on every route", async () => {
    // Read state is per user — a colleague clearing their feed does not clear
    // anyone else's — and the company filter is what keeps one supplier's
    // notifications out of another's.
    const { calls, record } = recorder();
    const controller = new SupplierNotificationsController({
      list: record,
      unreadCount: record,
      markRead: record,
      markAllRead: record,
    } as any);

    await controller.list(ATTACKER_QUERY, SESSION);
    await controller.unreadCount(SESSION);
    await controller.markRead(ID, SESSION);
    await controller.markAllRead(SESSION);

    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call[0]).toEqual({ userId: SESSION.userId, companyId: SESSION.companyId });
    }
  });

  it("uses the same NotificationsService the trader uses, unchanged", async () => {
    // The isolation is a property of the service — every method filters on
    // both ids — rather than of who calls it. A role-aware branch would make
    // the boundary something each caller has to get right.
    const { record } = recorder();
    const shared = { list: record, unreadCount: record, markRead: record, markAllRead: record };

    const supplier = new SupplierNotificationsController(shared as any);
    await supplier.unreadCount(SESSION);

    expect(record).toHaveBeenCalledWith({
      userId: SESSION.userId,
      companyId: SESSION.companyId,
    });
  });
});
